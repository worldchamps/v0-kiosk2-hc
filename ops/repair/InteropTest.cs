using System;
using System.IO;
internal static class InteropTest
{
    static void Check(bool ok) { if (!ok) throw new Exception("Discovery test failed"); }
    static void TestDiscovery(string exe)
    {
        string expected = Path.GetFullPath(exe);
        int picks = 0;
        Func<string> pick = () => { picks++; return exe; };
        Check(KioskRepair.SelectExecutable(new string[0], pick) == expected && picks == 1);
        picks = 0;
        Check(KioskRepair.SelectExecutable(new[] { exe, exe.ToUpperInvariant(), exe.Replace('\\', '/'), Path.Combine(Path.GetDirectoryName(exe), ".", Path.GetFileName(exe)) }, pick) == expected && picks == 0);
        Check(KioskRepair.SelectExecutable(new string[0], () => null) == null);
        Check(KioskRepair.SelectExecutable(new[] { Path.Combine(Path.GetDirectoryName(exe), "missing.exe") }, pick) == expected && picks == 1);
        bool rejected = false;
        try { KioskRepair.SelectExecutable(new string[0], () => System.Reflection.Assembly.GetExecutingAssembly().Location); }
        catch (InvalidOperationException) { rejected = true; }
        Check(rejected);
        string dist = Directory.GetParent(Path.GetDirectoryName(exe)).Parent.FullName;
        string other = Path.Combine(dist, Environment.Is64BitProcess ? @"ia32\win-ia32-unpacked\TheBeachStay Kiosk.exe" : @"x64\win-unpacked\TheBeachStay Kiosk.exe");
        picks = 0;
        Check(KioskRepair.SelectExecutable(new[] { other, exe }, pick) == expected && picks == 1);
        Console.WriteLine("DISCOVERY PASS: missing / duplicate paths / multiple installs / stale / cancel / wrong executable");
    }
    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || (args.Length == 1 && args[0] == "--picker"))
            {
                // UI-only harness: selection/validation, no config access or kiosk execution.
                string selected = KioskRepair.SelectExecutable(new string[0], KioskRepair.PickExecutable);
                Console.WriteLine(selected == null ? "PICKER_CANCEL_PASS" : "PICKER_VALIDATION_PASS");
                System.Windows.Forms.MessageBox.Show(selected == null ? "PICKER_CANCEL_PASS" : "PICKER_VALIDATION_PASS", "Kiosk Repair UI Test - no configuration changes");
                return 0;
            }
            if (args.Length != 2 || !Path.GetFileName(args[1]).StartsWith("kiosk-repair-interop-")) throw new Exception("Synthetic test directory required");
            TestDiscovery(args[0]);
            using (var child = KioskRepair.Start(args[0]))
            try
            {
                KioskRepair.Send(child, KioskRepair.Request(args[1]));
                var preview = KioskRepair.Response(child);
                if ((string)preview["deviceId"] != "qa-synthetic-a" || (bool)preview["alreadyA"]) throw new Exception("Unexpected fixture");
                KioskRepair.Send(child, "CONFIRM_PROPERTY3_A_IDLE");
                var result = KioskRepair.Response(child);
                if (!(bool)result["changed"] || !child.WaitForExit(10000) || child.ExitCode != 0) throw new Exception("Repair failed");
                Console.WriteLine("DPAPI + EMBEDDED REPAIR PASS (launcher {0}-bit)", Environment.Is64BitProcess ? 64 : 32);
            }
            finally { child.StandardInput.Close(); if (!child.WaitForExit(2000)) child.Kill(); }
            return 0;
        }
        catch { Console.WriteLine("INTEROP TEST FAILED"); return 1; }
    }
}
