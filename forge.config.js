const path = require("path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const { execFileSync } = require("node:child_process")
const fs = require("fs")

module.exports = {
  packagerConfig: {
    asar: {
      unpack: "**/node_modules/node-pty/**"
    },
    appBundleId: "com.sevenxy.meshWeb",
    appCategoryType: "public.app-category.utilities",
    name: "Mesh Web",
    icon: path.resolve(__dirname, "assets", "icon"),
    extraResource: [
      "bin"
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"]
    }
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ],
  hooks: {
    postPackage: async (forgeConfig, options) => {
      if (process.platform !== "darwin") return

      for (let outputPath of options.outputPaths) {
        let helperPath = path.join(
            outputPath,
            "Mesh Web.app",
            "Contents",
            "Resources",
            "app.asar.unpacked",
            "node_modules",
            "node-pty",
            "prebuilds",
            process.arch === "arm64" ? "darwin-arm64" : "darwin-x64",
            "spawn-helper"
        )

        if (fs.existsSync(helperPath)) {
          fs.chmodSync(helperPath, 0o755)
        }

        let appPath = path.join(outputPath, "Mesh Web.app")

        execFileSync("codesign", [
          "--force",
          "--deep",
          "--sign",
          "-",
          appPath
        ], {
          stdio: "inherit"
        })
      }
    }
  }
};