const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
    if (process.platform !== 'win32') {
        return;
    }

    const outputDir = context.appOutDir;
    const outputExe = path.join(outputDir, 'CodeHive.exe');
    const tempCs = path.join(outputDir, '_launcher_temp.cs');
    const iconPath = path.join(__dirname, '..', 'CodeHive.ico');

    const csCode = `
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class Program {
    static void Main(string[] args) {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string mucha = Path.Combine(dir, "MUCHA.exe");
        var psi = new ProcessStartInfo(mucha);
        psi.UseShellExecute = true;
        if (args.Length > 0) {
            psi.Arguments = string.Join(" ", args);
        }
        Process.Start(psi);
    }
}`.trim();

    fs.writeFileSync(tempCs, csCode, 'utf8');

    try {
        const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
        const iconFlag = fs.existsSync(iconPath) ? ` /win32icon:"${iconPath}"` : '';
        execSync(`"${cscPath}" /target:winexe /out:"${outputExe}"${iconFlag} "${tempCs}"`, { stdio: 'inherit' });
        console.log('Created CodeHive.exe launcher');
    } finally {
        fs.unlinkSync(tempCs);
    }
};
