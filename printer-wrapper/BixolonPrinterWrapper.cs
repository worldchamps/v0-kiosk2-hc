using System;
using System.Runtime.InteropServices;
using System.Text;

namespace BixolonPrinterWrapper
{
    class Program
    {
        // BXLPApi.dll 함수 임포트
        [DllImport("BXLPApi_X64.dll", CharSet = CharSet.Ansi)]
        static extern int ConnectSerial(string portName, int baudRate);

        [DllImport("BXLPApi_X64.dll")]
        static extern int DisconnectSerial();

        [DllImport("BXLPApi_X64.dll", CharSet = CharSet.Ansi)]
        static extern int PrintText(string text, int alignment, int attribute, int textSize, int language);

        [DllImport("BXLPApi_X64.dll")]
        static extern int LineFeed(int lines);

        [DllImport("BXLPApi_X64.dll")]
        static extern int CutPaper();

        [DllImport("BXLPApi_X64.dll")]
        static extern int GetStatus();

        static void Main(string[] args)
        {
            if (args.Length == 0)
            {
                Console.WriteLine("ERROR: No command specified");
                return;
            }

            string command = args[0].ToLower();

            try
            {
                switch (command)
                {
                    case "connect":
                        string port = args.Length > 1 ? args[1] : "COM2";
                        int baudRate = args.Length > 2 ? int.Parse(args[2]) : 9600;
                        int result = ConnectSerial(port, baudRate);
                        Console.WriteLine(result == 0 ? "OK" : $"ERROR: {result}");
                        break;

                    case "disconnect":
                        DisconnectSerial();
                        Console.WriteLine("OK");
                        break;

                    case "print":
                        if (args.Length < 2)
                        {
                            Console.WriteLine("ERROR: No text specified");
                            return;
                        }
                        string text = args[1];
                        int printResult = PrintText(text, 0, 0, 0, 0);
                        Console.WriteLine(printResult == 0 ? "OK" : $"ERROR: {printResult}");
                        break;

                    case "linefeed":
                        int lines = args.Length > 1 ? int.Parse(args[1]) : 1;
                        int lfResult = LineFeed(lines);
                        Console.WriteLine(lfResult == 0 ? "OK" : $"ERROR: {lfResult}");
                        break;

                    case "cut":
                        int cutResult = CutPaper();
                        Console.WriteLine(cutResult == 0 ? "OK" : $"ERROR: {cutResult}");
                        break;

                    case "status":
                        int status = GetStatus();
                        Console.WriteLine($"STATUS: {status}");
                        break;

                    default:
                        Console.WriteLine($"ERROR: Unknown command '{command}'");
                        break;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ERROR: {ex.Message}");
            }
        }
    }
}
