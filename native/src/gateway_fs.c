/*
 * gateway_fs — narrow Darwin native filesystem primitive (MAC-1).
 *
 * The ONLY native boundary of Project Gateway for macOS. Implements the
 * descriptor-relative operations that Node's public fs API cannot express
 * on Darwin, preserving the inherited descriptor-anchored security
 * contract (MAC-0 contract §4-§5):
 *
 *   - openat(...)          descriptor-relative open (dir traversal + final
 *                          create + recovery type-inspection open);
 *   - unlinkat(...)        descriptor-relative unlink (cleanup);
 *   - fcntl(F_GETPATH,..)  descriptor -> current canonical path
 *                          (descriptor-bound parent identity).
 *
 * Deliberate non-goals (fail-closed by absence):
 *   - no absolute-path open/unlink/stat (root anchoring stays in Node);
 *   - no mkdir, rename, chmod, readdir, recursive deletion;
 *   - no shell/exec/subprocess;
 *   - no path normalization/canonicalization/globbing/multi-component
 *     traversal; every path-bearing operation takes EXACTLY ONE final
 *     component;
 *   - no /proc, no /dev/fd anywhere.
 *
 * Node-API (C) only, pinned NAPI_VERSION=8 (see binding.gyp): stable ABI,
 * no V8/libuv/node-internal/NAN/FFI dependencies. No experimental
 * Node-API features are used.
 *
 * Error boundary: every function returns a plain frozen-free result
 * object `{ok:true,...}` or `{ok:false, code}` with a closed internal
 * vocabulary (see map_errno). The native boundary never throws for
 * malformed input or expected filesystem outcomes; a malformed request is
 * a typed failure, never a crash. No errno numbers, paths, or stack
 * traces are exposed. A napi_throw is used ONLY as a last resort for
 * internal result-construction failure (allocation-level), after any
 * fd created by this call has been closed.
 *
 * fd ownership (MAC-1 report §9):
 *   - incoming fds are caller-owned; never closed, never duplicated;
 *   - a newly opened fd becomes caller-owned ONLY on successful return;
 *   - no native temporary fds exist outside the returned fd;
 *   - on any internal failure after a successful openat, the created fd
 *     is closed before returning/throwing.
 */
#define _DARWIN_C_SOURCE 1

#include <node_api.h>

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* ------------------------------------------------------------------ */
/* Closed internal result vocabulary                                   */
/* ------------------------------------------------------------------ */

/*
 * errno -> internal code. Deterministic; unknown errno values map to
 * `io-failure` (generic fail-closed). MAC-2 maps these internal codes
 * into the inherited externally visible Gateway error vocabularies.
 */
static const char *map_errno(int e) {
  switch (e) {
    case ENOENT:     return "not-found";
    case EEXIST:     return "exists";
    case ENOTDIR:    return "not-directory";
    case ELOOP:      return "symlink-refused";
    case EMLINK:     return "symlink-refused";
    case EACCES:     return "permission-denied";
    case EPERM:      return "permission-denied";
    case EROFS:      return "read-only";
    case ENOSPC:     return "no-space";
    case EDQUOT:     return "quota";
    case EOPNOTSUPP: return "unsupported";
    case ENOTSUP:    return "unsupported";
    case EBADF:      return "invalid-fd";
    case EINVAL:     return "invalid-input";
    case ENAMETOOLONG: return "invalid-input";
    default:         return "io-failure";
  }
}

/* ------------------------------------------------------------------ */
/* Small napi helpers (checked; never leave a pending exception)       */
/* ------------------------------------------------------------------ */

static napi_value make_result(napi_env env, bool ok, const char *code, int fd, const char *path, size_t path_len) {
  napi_value obj, v;
#define CHECK(call) do { if ((call) != napi_ok) { goto fail; } } while (0)
  CHECK(napi_create_object(env, &obj));
  CHECK(napi_get_boolean(env, ok, &v));
  CHECK(napi_set_named_property(env, obj, "ok", v));
  if (!ok) {
    CHECK(napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &v));
    CHECK(napi_set_named_property(env, obj, "code", v));
  } else {
    if (fd >= 0) {
      CHECK(napi_create_int32(env, fd, &v));
      CHECK(napi_set_named_property(env, obj, "fd", v));
    }
    if (path != NULL) {
      CHECK(napi_create_string_utf8(env, path, path_len, &v));
      CHECK(napi_set_named_property(env, obj, "path", v));
    }
  }
  return obj;
#undef CHECK
fail:
  /* internal allocation-level failure: the only throwing path. The
   * caller closes any fd it created before invoking make_result. */
  napi_throw_error(env, NULL, "gateway-fs: internal result construction failure");
  return NULL;
}

static napi_value result_fail(napi_env env, const char *code) {
  return make_result(env, false, code, -1, NULL, 0);
}

/* `created_fd` is the fd this call created (caller-owned on success);
 * closed here if result construction fails so nothing leaks. */
static napi_value result_ok_fd(napi_env env, int created_fd) {
  napi_value r = make_result(env, true, NULL, created_fd, NULL, 0);
  if (r == NULL) close(created_fd);
  return r;
}

static napi_value result_ok_plain(napi_env env) {
  return make_result(env, true, NULL, -1, NULL, 0);
}

/* ------------------------------------------------------------------ */
/* Argument validation (fail closed on malformed input)                */
/* ------------------------------------------------------------------ */

#define COMPONENT_MAX PATH_MAX /* 1024 on Darwin; bounds the stack copy */

typedef struct {
  int fd;
  char component[COMPONENT_MAX];
  size_t component_len;
} anchored_args;

/*
 * Validate a single final component: non-empty, not "." or "..", no '/',
 * no NUL, and representable within the bounded stack buffer. Backslash is
 * a legal POSIX filename character and is intentionally NOT rejected
 * here; the Gateway lexical guard (validateComponent, src/writing/
 * executor.ts) continues to reject it at the JS layer.
 */
static bool valid_component(const char *s, size_t len) {
  if (len == 0) return false;
  if (s[0] == '.' && (len == 1 || (len == 2 && s[1] == '.'))) return false;
  for (size_t i = 0; i < len; i++) {
    if (s[i] == '/') return false;
  }
  return true;
}

/* fd validation: JS number, integral, 0..INT32_MAX, no coercion. */
static bool parse_fd(napi_env env, napi_value arg, int *out) {
  napi_valuetype t;
  double d;
  if (napi_typeof(env, arg, &t) != napi_ok || t != napi_number) return false;
  if (napi_get_value_double(env, arg, &d) != napi_ok) return false;
  if (!(d >= 0)) return false;             /* NaN, -Inf, negatives */
  if (d > INT32_MAX) return false;
  if ((double)(int64_t)d != d) return false; /* non-integral */
  *out = (int)d;
  return true;
}

/* component validation: JS string, bounded length, single component. */
static bool parse_component(napi_env env, napi_value arg, char *buf, size_t buf_size, size_t *out_len) {
  napi_valuetype t;
  size_t len = 0;
  size_t copied = 0;
  if (napi_typeof(env, arg, &t) != napi_ok || t != napi_string) return false;
  if (napi_get_value_string_utf8(env, arg, NULL, 0, &len) != napi_ok) return false;
  if (len == 0 || len >= buf_size) return false; /* empty or unsafe length */
  if (napi_get_value_string_utf8(env, arg, buf, buf_size, &copied) != napi_ok) return false;
  if (copied != len) return false;
  if (memchr(buf, '\0', len) != NULL) return false; /* embedded NUL */
  if (!valid_component(buf, len)) return false;
  *out_len = len;
  return true;
}

/* Parse (fd, component). Exact argument count; no coercion. */
static bool parse_anchored(napi_env env, napi_callback_info info, anchored_args *out) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return false;
  if (argc != 2) return false;
  if (!parse_fd(env, argv[0], &out->fd)) return false;
  if (!parse_component(env, argv[1], out->component, COMPONENT_MAX, &out->component_len)) return false;
  return true;
}

/* Parse a single fd argument. */
static bool parse_fd_only(napi_env env, napi_callback_info info, int *out) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return false;
  if (argc != 1) return false;
  return parse_fd(env, argv[0], out);
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/*
 * openDirectoryAt(parentFd, component) -> {ok:true, fd} | {ok:false, code}
 *
 * Descriptor-relative directory open: O_RDONLY|O_DIRECTORY|O_NOFOLLOW
 * (plus O_CLOEXEC hygiene). Resolves the single component relative to the
 * supplied directory fd — never from cwd/root, never following the final
 * symlink. Needed by MAC-2 for the inherited anchored parent traversal
 * (executor step 2, completion writer descent).
 */
static napi_value open_directory_at(napi_env env, napi_callback_info info) {
  anchored_args a;
  if (!parse_anchored(env, info, &a)) return result_fail(env, "invalid-input");
  int fd;
  do {
    fd = openat(a.fd, a.component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  } while (fd < 0 && errno == EINTR);
  if (fd < 0) return result_fail(env, map_errno(errno));
  return result_ok_fd(env, fd);
}

/*
 * createExclusiveFileAt(parentFd, component) -> {ok:true, fd}
 *
 * Descriptor-relative exclusive create: O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW
 * (+ O_CLOEXEC). The creation mode is HARDCODED to 0600 inside the
 * native seam (F-1 correction, MAC-1 focused review): the caller cannot
 * supply any mode, so no caller-controlled mode — including setuid/
 * setgid/sticky bits — can ever reach openat. Arity is exactly 2; a
 * third argument is rejected by the normal wrong-arity path. Never
 * overwrites: any existing object (file, directory, symlink, dangling
 * symlink) is `exists`. Exactly one final component below the verified
 * parent fd. Needed by MAC-2 for the inherited create-only final step
 * (executor step 3, completion writer create). The inherited
 * Node/Gateway fchmod step (for umask-independent verification) remains
 * in Gateway and is NOT moved here.
 */
static napi_value create_exclusive_file_at(napi_env env, napi_callback_info info) {
  anchored_args a;
  if (!parse_anchored(env, info, &a)) return result_fail(env, "invalid-input");
  int fd;
  do {
    fd = openat(a.fd, a.component, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600);
  } while (fd < 0 && errno == EINTR);
  if (fd < 0) return result_fail(env, map_errno(errno));
  return result_ok_fd(env, fd);
}

/*
 * openExistingFileAt(parentFd, component) -> {ok:true, fd}
 *
 * Descriptor-relative type-inspection open with FIXED flags
 * (O_RDONLY|O_NOFOLLOW|O_NONBLOCK + O_CLOEXEC) — the inherited
 * completion-recovery pattern (SIR-WP13B-002). No caller-controlled
 * flags: this is not a generic open. The fstat-based regular-file/uid
 * verification and the recovery read stay in Node (Gateway). A symlink
 * final component is refused (ELOOP -> symlink-refused). Needed by MAC-2
 * for the EEXIST recovery read in src/completion/writer.ts.
 */
static napi_value open_existing_file_at(napi_env env, napi_callback_info info) {
  anchored_args a;
  if (!parse_anchored(env, info, &a)) return result_fail(env, "invalid-input");
  int fd;
  do {
    fd = openat(a.fd, a.component, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  } while (fd < 0 && errno == EINTR);
  if (fd < 0) return result_fail(env, map_errno(errno));
  return result_ok_fd(env, fd);
}

/*
 * unlinkAt(parentFd, component) -> {ok:true} | {ok:false, code}
 *
 * Descriptor-relative unlink of EXACTLY ONE final component below the
 * supplied directory fd; never an absolute target; no AT_REMOVEDIR, so a
 * directory can never be removed through this seam (unlink on a
 * directory fails with EPERM -> permission-denied). The fd remains the
 * anchor: renaming/replacing the lexical pathname does not redirect the
 * unlink. Needed by MAC-2 for the inherited at-most-one-attempt cleanup
 * of the object created by the operation (executor step 6, writer
 * cleanup).
 */
static napi_value unlink_at(napi_env env, napi_callback_info info) {
  anchored_args a;
  if (!parse_anchored(env, info, &a)) return result_fail(env, "invalid-input");
  int r;
  do {
    r = unlinkat(a.fd, a.component, 0);
  } while (r < 0 && errno == EINTR);
  if (r < 0) return result_fail(env, map_errno(errno));
  return result_ok_plain(env);
}

/*
 * getPath(fd) -> {ok:true, path} | {ok:false, code}
 *
 * fcntl(F_GETPATH) on a bounded PATH_MAX stack buffer (no unbounded
 * allocation). Returns the vnode's current path at call time — after a
 * rename the fd reports the NEW path, which is exactly the divergence
 * property MAC-2 needs for the inherited parent-not-verified semantics.
 * NUL-bounded conversion; a missing terminator is a typed io-failure.
 * Closed/invalid fd -> invalid-fd. No raw pointers, errno numbers, or
 * paths are logged or exposed beyond the returned string.
 */
static napi_value get_path(napi_env env, napi_callback_info info) {
  int fd;
  char buf[PATH_MAX];
  if (!parse_fd_only(env, info, &fd)) return result_fail(env, "invalid-input");
  if (fcntl(fd, F_GETPATH, buf) < 0) return result_fail(env, map_errno(errno));
  void *nul = memchr(buf, '\0', PATH_MAX);
  if (nul == NULL) return result_fail(env, "io-failure");
  size_t len = (size_t)((const char *)nul - buf);
  napi_value r = make_result(env, true, NULL, -1, buf, len);
  return r;
}

/* ------------------------------------------------------------------ */
/* Descriptor-bound directory enumeration (MAC-2D-NATIVE)              */
/* ------------------------------------------------------------------ */

/*
 * Authoritative native hard cap: derived from the committed WP-7 reader
 * ceiling `WP7_LIMITS.MAX_DIRECTORY_ENTRIES = 10_000`
 * (src/reader/types.ts). The reader's JS `maxEntries` is bounded by that
 * same ceiling, so a native cap of 10_000 can never change the JS-side
 * truncation behavior. NOT an invented value (MAC-2D-NATIVE §3).
 */
#define READ_DIR_ENTRY_CAP 10000u

/* Bounded name storage: NAME_MAX (255) + NUL (Darwin). */
#define READ_DIR_NAME_BUF 256u

typedef struct {
  char name[READ_DIR_NAME_BUF];
  uint8_t kind; /* 0=file 1=directory 2=symlink 3=other */
} readdir_entry;

/* d_type -> the reader's closed four-kind hint vocabulary (index into KIND_HINTS). */
static const char *const KIND_HINTS[4] = { "file", "directory", "symlink", "other" };

static uint8_t d_type_to_kind_index(uint8_t t) {
  switch (t) {
    case DT_REG: return 0;
    case DT_DIR: return 1;
    case DT_LNK: return 2;
    default: return 3; /* FIFO/socket/device/unknown: never followed, never stat'd */
  }
}

/*
 * readDirectoryEntries(fd) -> {ok:true, entries:[{name, kindHint}],
 * truncated} | {ok:false, code}
 *
 * Bounded descriptor-bound directory enumeration (MAC-2D-NATIVE; the ONLY
 * new native capability). The caller fd is never closed, duplicated, or
 * consumed:
 *
 *   - a PRIVATE descriptor is obtained with openat(fd, ".",
 *     O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC) — the dot resolves
 *     within the caller's directory description (no pathname, no
 *     re-resolution, no cwd); rename/replacement of the directory's old
 *     lexical pathname cannot redirect it; the private descriptor is a
 *     NEW open-file description, so caller-visible directory stream
 *     position state is never shared or advanced;
 *   - plain dup(fd) was NOT used: dup shares the underlying open-file
 *     description (shared directory offset), which would make repeated
 *     enumerations of one caller fd consume each other (probed on the
 *     real Intel host: dup+fdopendir twice -> 6 entries then 0;
 *     openat(fd,".")+fdopendir twice -> 6 then 6);
 *   - fdopendir(priv) takes ownership of the private descriptor; the
 *     stream (closedir) closes it EXACTLY once on every path;
 *   - one bounded pass: '.' and '..' skipped; at most
 *     READ_DIR_ENTRY_CAP entries collected; the (cap+1)-th entry sets
 *     truncated=true and stops collecting (off-by-one: exactly cap
 *     entries => truncated:false);
 *   - bounded native allocation: one fixed calloc of
 *     READ_DIR_ENTRY_CAP * sizeof(readdir_entry) (~2.6 MB worst case),
 *     freed on every path; no unbounded list/realloc;
 *   - d_name handled with strict bounds (d_namlen clamped to
 *     NAME_BUF-1, NUL-terminated, embedded NUL = malformed => entry
 *     skipped); entries are raw, in readdir order — sorting and
 *     maxEntries truncation remain the reader's JS responsibility;
 *   - kindHint from d_type only; symlinks are returned as entries and
 *     never followed; unknown types are 'other' (no stat-per-entry
 *     authority is gained to classify them).
 *
 * Result construction allocates many N-API objects; ANY construction
 * failure after the stream is acquired closes the stream exactly once,
 * frees the array, and surfaces the established internal-failure
 * mechanism — no leak on partial construction.
 */
static napi_value read_directory_entries(napi_env env, napi_callback_info info) {
  int fd;
  if (!parse_fd_only(env, info, &fd)) return result_fail(env, "invalid-input");

  /* 1. Private independent descriptor bound to the SAME directory object. */
  int priv;
  do {
    priv = openat(fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  } while (priv < 0 && errno == EINTR);
  if (priv < 0) return result_fail(env, map_errno(errno));

  /* 2. Directory stream over the PRIVATE descriptor only. */
  errno = 0;
  DIR *dir = fdopendir(priv);
  if (dir == NULL) {
    int e = errno;
    close(priv); /* fdopendir failed: we still own priv; close it once */
    return result_fail(env, map_errno(e));
  }
  /* From here, priv is owned by the stream; never close(priv) directly. */

  /* 3. Bounded single pass into a fixed preallocated array. */
  readdir_entry *entries = (readdir_entry *)calloc(READ_DIR_ENTRY_CAP, sizeof(readdir_entry));
  if (entries == NULL) {
    closedir(dir);
    return result_fail(env, "io-failure");
  }
  size_t count = 0;
  bool truncated = false;
  for (;;) {
    errno = 0;
    struct dirent *d = readdir(dir);
    if (d == NULL) {
      if (errno != 0) {
        int e = errno;
        closedir(dir);
        free(entries);
        return result_fail(env, map_errno(e));
      }
      break; /* end of directory */
    }
    /* Skip . and .. (the reader's opendir contract excludes them). */
    if (d->d_name[0] == '.' &&
        (d->d_name[1] == '\0' || (d->d_name[1] == '.' && d->d_name[2] == '\0'))) {
      continue;
    }
    /* Hard cap: the (cap+1)-th real entry stops collection. */
    if (count >= READ_DIR_ENTRY_CAP) {
      truncated = true;
      break;
    }
    /* Strict d_name bounds: clamp d_namlen, NUL-terminate, and skip a
     * malformed name carrying an embedded NUL (unreachable from the
     * kernel; defensive — no NUL injection into JS). */
    size_t namlen = (size_t)d->d_namlen;
    if (namlen > READ_DIR_NAME_BUF - 1) namlen = READ_DIR_NAME_BUF - 1;
    if (memchr(d->d_name, '\0', namlen) != NULL) continue;
    memcpy(entries[count].name, d->d_name, namlen);
    entries[count].name[namlen] = '\0';
    entries[count].kind = d_type_to_kind_index(d->d_type);
    count++;
  }

  /* 4. Build the JS result; every napi status checked. */
  napi_value result_obj, ok_val, entries_arr, truncated_val, entry_obj, name_str, kind_str;
  if (napi_create_object(env, &result_obj) != napi_ok) goto internal_fail;
  if (napi_get_boolean(env, true, &ok_val) != napi_ok) goto internal_fail;
  if (napi_set_named_property(env, result_obj, "ok", ok_val) != napi_ok) goto internal_fail;
  if (napi_create_array_with_length(env, count, &entries_arr) != napi_ok) goto internal_fail;
  for (size_t i = 0; i < count; i++) {
    const char *kind = KIND_HINTS[entries[i].kind];
    if (napi_create_object(env, &entry_obj) != napi_ok) goto internal_fail;
    if (napi_create_string_utf8(env, entries[i].name, NAPI_AUTO_LENGTH, &name_str) != napi_ok) goto internal_fail;
    if (napi_set_named_property(env, entry_obj, "name", name_str) != napi_ok) goto internal_fail;
    if (napi_create_string_utf8(env, kind, NAPI_AUTO_LENGTH, &kind_str) != napi_ok) goto internal_fail;
    if (napi_set_named_property(env, entry_obj, "kindHint", kind_str) != napi_ok) goto internal_fail;
    if (napi_set_element(env, entries_arr, (uint32_t)i, entry_obj) != napi_ok) goto internal_fail;
  }
  if (napi_set_named_property(env, result_obj, "entries", entries_arr) != napi_ok) goto internal_fail;
  if (napi_get_boolean(env, truncated, &truncated_val) != napi_ok) goto internal_fail;
  if (napi_set_named_property(env, result_obj, "truncated", truncated_val) != napi_ok) goto internal_fail;
  closedir(dir);
  free(entries);
  return result_obj;

internal_fail:
  /* Close the stream (which owns the private descriptor) EXACTLY once,
   * free the fixed allocation, never touch the caller fd, and surface the
   * established internal-failure mechanism. */
  closedir(dir);
  free(entries);
  napi_throw_error(env, NULL, "gateway-fs: internal result construction failure");
  return NULL;
}


#define EXPORT(name, fn) \
  { name, NULL, (fn), NULL, NULL, NULL, napi_writable | napi_enumerable, NULL }

static napi_value module_init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    EXPORT("openDirectoryAt", open_directory_at),
    EXPORT("createExclusiveFileAt", create_exclusive_file_at),
    EXPORT("openExistingFileAt", open_existing_file_at),
    EXPORT("unlinkAt", unlink_at),
    EXPORT("getPath", get_path),
    EXPORT("readDirectoryEntries", read_directory_entries),
  };
  if (napi_define_properties(env, exports, 6, props) != napi_ok) {
    napi_throw_error(env, NULL, "gateway-fs: module registration failure");
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, module_init)
