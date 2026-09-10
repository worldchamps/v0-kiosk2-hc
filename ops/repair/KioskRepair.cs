using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class KioskRepair
{
    const string Title = "property3 A동 설정 복구 v2";
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static void Require(bool ok, string message) { if (!ok) throw new InvalidOperationException(message); }
    internal static Dictionary<string, object> Parse(string value) { return Json.Deserialize<Dictionary<string, object>>(value); }
    // The embedded script ends with a newline, not a trailing backslash.
    static string Quote(string value) { return "\"" + System.Text.RegularExpressions.Regex.Replace(value, "(\\\\*)\"", "$1$1\\\"") + "\""; }
    static void Idle()
    {
        Require(Process.GetProcessesByName("TheBeachStay Kiosk").Length == 0,
            "키오스크가 실행 중입니다.\n고객 거래가 없는지 확인한 뒤 키오스크를 정상 종료하고 다시 실행해 주세요.\n강제 종료하거나 PC를 재부팅하지는 않습니다.");
    }
    internal static string Locate()
    {
        var dirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
        dirs.Add(Path.Combine(programs, "TheBeachStay Kiosk"));
        dirs.Add(Path.Combine(programs, "thebeachstay-kiosk"));
        foreach (var view in new[] { RegistryView.Registry32, RegistryView.Registry64 })
        using (var root = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view))
        using (var uninstall = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
        {
            if (uninstall == null) continue;
            foreach (string name in uninstall.GetSubKeyNames())
            using (var entry = uninstall.OpenSubKey(name))
                if (entry != null && ((string)entry.GetValue("DisplayName", "") == "TheBeachStay Kiosk" ||
                    ((string)entry.GetValue("DisplayName", "")).StartsWith("TheBeachStay Kiosk ", StringComparison.Ordinal)))
                {
                    string location = entry.GetValue("InstallLocation", "") as string;
                    if (!String.IsNullOrWhiteSpace(location)) dirs.Add(location);
                    string icon = entry.GetValue("DisplayIcon", "") as string;
                    if (!String.IsNullOrWhiteSpace(icon))
                    {
                        int comma = icon.LastIndexOf(',');
                        string iconPath = (comma >= 0 ? icon.Substring(0, comma) : icon).Trim('"');
                        if (String.Equals(Path.GetFileName(iconPath), "TheBeachStay Kiosk.exe", StringComparison.OrdinalIgnoreCase))
                            dirs.Add(Path.GetDirectoryName(iconPath));
                    }
                    // electron-builder stores InstallLocation in a separate key;
                    // the uninstall entry contains the quoted uninstaller path.
                    string command = entry.GetValue("UninstallString", "") as string;
                    if (command != null && command.StartsWith("\"", StringComparison.Ordinal))
                    {
                        int end = command.IndexOf('"', 1);
                        if (end > 1)
                        {
                            string uninstaller = command.Substring(1, end - 1);
                            if (Path.GetFileName(uninstaller) == "Uninstall TheBeachStay Kiosk.exe")
                                dirs.Add(Path.GetDirectoryName(uninstaller));
                        }
                    }
                }
        }
        return SelectExecutable(dirs.Select(d => Path.Combine(d, "TheBeachStay Kiosk.exe")), PickExecutable);
    }
    internal static string PickExecutable()
    {
        using (var picker = new OpenFileDialog())
        {
            picker.Title = "바탕화면의 TheBeachStay Kiosk 바로가기 선택 (installer.exe 아님)";
            picker.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            picker.Filter = "키오스크 실행파일 또는 바로가기|*.exe;*.lnk";
            picker.DereferenceLinks = true;
            picker.CheckFileExists = true;
            picker.Multiselect = false;
            return picker.ShowDialog() == DialogResult.OK ? picker.FileName : null;
        }
    }
    internal static string SelectExecutable(IEnumerable<string> paths, Func<string> choose)
    {
        // Equivalent registry/default paths must not count as multiple installs.
        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string path in paths)
        {
            try { candidates.Add(ValidateExecutable(path)); }
            catch { /* Stale/unsupported registrations do not block manual selection. */ }
        }
        if (candidates.Count == 1) return candidates.Single();
        string selected = choose(); // no match OR ambiguous: operator chooses, never guess
        return selected == null ? null : ValidateExecutable(selected);
    }
    internal static string ValidateExecutable(string path)
    {
        string exe = Path.GetFullPath(path);
        Require(File.Exists(exe) && String.Equals(Path.GetFileName(exe), "TheBeachStay Kiosk.exe", StringComparison.OrdinalIgnoreCase),
            "기존 TheBeachStay Kiosk 실행파일이나 바탕화면 바로가기를 선택해 주세요.\ninstaller.exe 또는 복구파일 자체를 선택하면 안 됩니다.\n설정은 변경하지 않았습니다.");
        var package = Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(exe), "resources", "app", "package.json")));
        Require((string)package["name"] == "thebeachstay-kiosk" && (string)package["version"] == "1.3.2" && (string)package["main"] == "electron/bootstrap.js",
            "이 복구파일은 설치형 키오스크 1.3.2용입니다. 현재 버전을 확인해 주세요.");
        var version = FileVersionInfo.GetVersionInfo(exe);
        Require(version.ProductName == "TheBeachStay Kiosk" && version.FileVersion == "1.3.2", "선택한 실행파일이 키오스크 1.3.2인지 확인해 주세요.");
        return exe;
    }
    internal static string Request(string dir)
    {
        string statePath = Path.Combine(dir, "Local State");
        Require(File.Exists(statePath) && File.Exists(Path.Combine(dir, "kiosk-device.bin")),
            "이 Windows 계정에서 기존 키오스크 설정을 찾지 못했습니다.\n평소 키오스크를 실행하던 계정으로 실행해 주세요. 재등록하거나 삭제하지 마세요.");
        byte[] state = File.ReadAllBytes(statePath);
        var crypt = (Dictionary<string, object>)Parse(Encoding.UTF8.GetString(state))["os_crypt"];
        byte[] wrapped = Convert.FromBase64String((string)crypt["encrypted_key"]);
        Require(wrapped.Length > 5 && Encoding.ASCII.GetString(wrapped, 0, 5) == "DPAPI", "지원하지 않는 설정 암호화 형식입니다.");
        byte[] key = ProtectedData.Unprotect(wrapped.Skip(5).ToArray(), null, DataProtectionScope.CurrentUser);
        try
        {
            Require(key.Length == 32, "설정 암호화 키 형식이 다릅니다.");
            using (var sha = SHA256.Create())
                return Json.Serialize(new { dir = dir, key = Convert.ToBase64String(key), stateHash = BitConverter.ToString(sha.ComputeHash(state)).Replace("-", "").ToLowerInvariant() });
        }
        finally { Array.Clear(key, 0, key.Length); }
    }
    internal static Process Start(string exe)
    {
        string script;
        using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("repair.cjs"))) script = reader.ReadToEnd();
        var start = new ProcessStartInfo(exe, "-e " + Quote(script) + " -- --repair") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
        start.EnvironmentVariables.Remove("NODE_OPTIONS");
        start.EnvironmentVariables.Remove("NODE_PATH");
        var process = Process.Start(start);
        process.BeginErrorReadLine(); // discard diagnostic output; never expose settings or keys
        return process;
    }
    internal static Dictionary<string, object> Response(Process process)
    {
        var line = process.StandardOutput.ReadLineAsync();
        Require(line.Wait(15000) && line.Result != null, "복구 응답을 받지 못했습니다. 관리자에게 문의해 주세요.");
        var response = Parse(line.Result);
        Require(!response.ContainsKey("error"), response.ContainsKey("error") ? (string)response["error"] : "");
        return response;
    }
    internal static void Send(Process process, string value)
    {
        // Windows .NET Framework may use the active ANSI codepage for stdin.
        // Node expects UTF-8, including Korean Windows account/profile paths.
        byte[] bytes = Encoding.UTF8.GetBytes(value + "\n");
        try { process.StandardInput.BaseStream.Write(bytes, 0, bytes.Length); process.StandardInput.BaseStream.Flush(); }
        finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Process child = null;
        bool acquired;
        using (var mutex = new System.Threading.Mutex(true, @"Local\TheBeachStay-Property3-A-Repair", out acquired))
        try
        {
            Require(acquired, "복구파일이 이미 실행 중입니다.");
            Idle();
            string exe = Locate();
            if (exe == null) return; // picker cancellation must never touch configuration
            Idle();
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "thebeachstay-kiosk");
            string request = Request(dir);
            child = Start(exe);
            Send(child, request);
            var preview = Response(child);
            if ((bool)preview["alreadyA"]) { MessageBox.Show("이미 A동으로 설정되어 있습니다.\n아무것도 변경하지 않았습니다. 오류 화면이 계속되면 관리자에게 알려 주세요.", Title); return; }
            if (MessageBox.Show("이 PC가 property3 A동 키오스크가 맞습니까?\n장비: " + (string)preview["deviceId"] +
                "\n\n진행 중이거나 미확정인 결제·입실·환불·인쇄가 없어야 합니다.\n기존 설정을 암호화 상태로 백업하고 A동 값 하나만 복구합니다.\n다른 PC나 B동에서는 실행하지 마세요.",
                Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            // Our Node-mode helper has the same executable name: exclude only its own PID.
            Require(Process.GetProcessesByName("TheBeachStay Kiosk").All(p => p.Id == child.Id), "키오스크가 다시 실행되었습니다. 복구를 중단합니다.");
            Send(child, "CONFIRM_PROPERTY3_A_IDLE");
            var result = Response(child);
            Require(child.WaitForExit(10000) && child.ExitCode == 0 && (bool)result["changed"], "복구 완료를 확인하지 못했습니다. 관리자에게 문의해 주세요.");
            MessageBox.Show("A동 설정 저장을 완료했습니다.\n\n키오스크를 다시 실행하고 A동 객실 목록이 나오는지 확인해 주세요.\n등록·프린터·결제 설정은 그대로 보존했습니다.\n\n백업: " + (string)result["backup"] + "\n(기존 설정 폴더 안에 보관)", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (InvalidOperationException error) { MessageBox.Show(error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        catch { MessageBox.Show("설정 복구를 완료하지 못했습니다.\n평소 키오스크를 실행하던 Windows 계정인지 확인해 주세요.\n설정과 백업 파일을 삭제하지 말고 관리자에게 문의해 주세요.", Title, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        finally
        {
            if (child != null)
            {
                try { child.StandardInput.Close(); if (!child.WaitForExit(2000)) child.Kill(); }
                catch { /* Only our helper is stopped; never terminate the kiosk. */ }
                child.Dispose();
            }
            if (acquired) mutex.ReleaseMutex();
        }
    }
}
