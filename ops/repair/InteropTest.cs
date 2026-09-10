using System;
using System.IO;
internal static class InteropTest
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2 || !Path.GetFileName(args[1]).StartsWith("kiosk-repair-interop-")) throw new Exception("Synthetic test directory required");
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
