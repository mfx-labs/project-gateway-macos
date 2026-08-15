{
  "targets": [
    {
      "target_name": "gateway_fs",
      "sources": [ "src/gateway_fs.c" ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "cflags": [ "-std=c11", "-Wall", "-Wextra" ]
          }
        ]
      ]
    }
  ]
}
