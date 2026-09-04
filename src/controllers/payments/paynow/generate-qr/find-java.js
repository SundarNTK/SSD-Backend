const { exec, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * The PayNow QR SDK (public/Paynowsdk/dist/PayQRSDK.jar) is a Java jar, not
 * a Node module — this locates a usable `java` executable on the host the
 * same way the HEB Payment-Service reference implementation does (PATH
 * first, then JAVA_HOME, then the common Windows install directories),
 * since a fresh machine running this service may never have added Java to
 * its PATH even when it's installed.
 */
function findJavaExecutable() {
  return new Promise((resolve, reject) => {
    const command = os.platform() === "win32" ? "where java" : "which java";

    exec(
      command,
      { env: { ...process.env, PATH: process.env.PATH || process.env.Path || "" }, shell: true },
      (error, stdout) => {
        if (!error && stdout && stdout.trim()) {
          const javaPath = stdout.trim().split("\n")[0].trim();
          execFile(javaPath, ["-version"], (verError) => {
            if (!verError) return resolve(javaPath);
            tryFallbackPaths(resolve, reject);
          });
          return;
        }
        tryFallbackPaths(resolve, reject);
      }
    );
  });
}

function tryFallbackPaths(resolve, reject) {
  if (os.platform() !== "win32") {
    reject(new Error("Java not found. Please ensure Java is installed and in your PATH."));
    return;
  }

  const commonPaths = [];
  if (process.env.JAVA_HOME) {
    commonPaths.push(path.join(process.env.JAVA_HOME, "bin", "java.exe"));
  }
  const programFilesPaths = [
    process.env["ProgramFiles"] || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  ];
  for (const programFiles of programFilesPaths) {
    const javaDir = path.join(programFiles, "Java");
    if (fs.existsSync(javaDir)) {
      try {
        for (const dir of fs.readdirSync(javaDir)) {
          const javaExe = path.join(javaDir, dir, "bin", "java.exe");
          if (fs.existsSync(javaExe)) commonPaths.push(javaExe);
        }
      } catch {
        // continue searching
      }
    }
  }

  if (commonPaths.length === 0) {
    reject(
      new Error(
        "Java is not found. Install Java and either add it to PATH or set JAVA_HOME, then restart this service."
      )
    );
    return;
  }

  let checked = 0;
  for (const javaPath of commonPaths) {
    execFile(javaPath, ["-version"], (error) => {
      checked++;
      if (!error) return resolve(javaPath);
      if (checked === commonPaths.length) {
        reject(
          new Error(
            "Java is not found. Install Java and either add it to PATH or set JAVA_HOME, then restart this service."
          )
        );
      }
    });
  }
}

module.exports = { findJavaExecutable };
