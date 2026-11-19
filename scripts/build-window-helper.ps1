# Build star-window-helper.exe (win32 window control helper) into resources/bin/win32
# Commands:
#   query <title>                -> JSON rect/iconic/topmost
#   minimize|restore|close <title>
#   topmost <title> on|off
#   move <title> <x> <y>
#   corners <title> <radius>     -> DWM no-round + SetWindowRgn rounded corners (0 = square)
#   dragloop <title> <offX> <offY> -> follow cursor until left button released
#   waitrelease                   -> block until left mouse button released (no window needed)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root 'resources\bin\win32'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$csPath = Join-Path $env:TEMP 'star-window-helper.cs'
$exePath = Join-Path $outDir 'star-window-helper.exe'

$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

class StarWindowHelper
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindow(string cls, string title);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X, Y; }

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr h, out RECT r);

    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr h);

    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr h);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr h);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr h, int cmd);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    static extern int GetWindowLong(IntPtr h, int idx);

    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

    [DllImport("user32.dll")]
    static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);

    [DllImport("gdi32.dll")]
    static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int rw, int rh);

    [DllImport("user32.dll")]
    static extern bool GetCursorPos(out POINT p);

    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vkey);

    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOZORDER = 0x0004;
    const uint SWP_NOACTIVATE = 0x0010;

    static void Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.WriteLine("{\"ok\":false,\"message\":\"usage\"}");
            return;
        }
        string cmd = args[0];

        // 只等待鼠标左键释放（供 Electron 主进程拖动循环判断松手，无需找窗口）
        if (cmd == "waitrelease")
        {
            while ((GetAsyncKeyState(0x01) & 0x8000) != 0) Thread.Sleep(10);
            Console.WriteLine("{\"ok\":true}");
            return;
        }

        if (args.Length < 2)
        {
            Console.WriteLine("{\"ok\":false,\"message\":\"usage\"}");
            return;
        }
        string title = args[1];
        IntPtr h = FindWindow(null, title);
        if (h == IntPtr.Zero)
        {
            Console.WriteLine("{\"ok\":false,\"found\":false}");
            return;
        }

        if (cmd == "query")
        {
            RECT r;
            bool hasFrame = DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0;
            if (!hasFrame) GetWindowRect(h, out r);
            bool iconic = IsIconic(h);
            bool visible = IsWindowVisible(h);
            bool topmost = (GetWindowLong(h, -20) & 0x8) != 0;
            Console.WriteLine("{\"ok\":true,\"found\":true,\"x\":" + r.Left + ",\"y\":" + r.Top
                + ",\"width\":" + (r.Right - r.Left) + ",\"height\":" + (r.Bottom - r.Top)
                + ",\"iconic\":" + (iconic ? "true" : "false")
                + ",\"visible\":" + (visible ? "true" : "false")
                + ",\"topmost\":" + (topmost ? "true" : "false") + "}");
        }
        else if (cmd == "minimize")
        {
            ShowWindow(h, 6);
            Console.WriteLine("{\"ok\":true}");
        }
        else if (cmd == "restore")
        {
            ShowWindow(h, 9);
            Console.WriteLine("{\"ok\":true}");
        }
        else if (cmd == "topmost")
        {
            bool on = args.Length > 2 && args[2] == "on";
            SetWindowPos(h, new IntPtr(on ? -1 : -2), 0, 0, 0, 0, 0x13);
            Console.WriteLine("{\"ok\":true,\"topmost\":" + (on ? "true" : "false") + "}");
        }
        else if (cmd == "close")
        {
            PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
            Console.WriteLine("{\"ok\":true}");
        }
        else if (cmd == "move")
        {
            int x = int.Parse(args[2]);
            int y = int.Parse(args[3]);
            SetWindowPos(h, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            Console.WriteLine("{\"ok\":true}");
        }
        else if (cmd == "hide")
        {
            ShowWindow(h, 0);
            Console.WriteLine("{\"ok\":true}");
        }
        else if (cmd == "show")
        {
            ShowWindow(h, 8);
            Console.WriteLine("{\"ok\":true}");
        }
        else if (cmd == "corners")
        {
            int radius = args.Length > 2 ? int.Parse(args[2]) : 0;
            // 可选第二半径(垂直)，用于椭圆外圈：corners <title> <rx> <ry>
            int radiusY = args.Length > 3 ? int.Parse(args[3]) : radius;
            int pref = 1; // DWMWCP_DONOTROUND
            DwmSetWindowAttribute(h, 33, ref pref, 4);
            if (radius > 0 || radiusY > 0)
            {
                RECT r;
                GetWindowRect(h, out r);
                IntPtr rgn = CreateRoundRectRgn(0, 0, r.Right - r.Left + 1, r.Bottom - r.Top + 1, radius * 2, radiusY * 2);
                SetWindowRgn(h, rgn, true);
            }
            else
            {
                SetWindowRgn(h, IntPtr.Zero, true);
            }
            Console.WriteLine("{\"ok\":true,\"radius\":" + radius + ",\"radiusY\":" + radiusY + "}");
        }
        else if (cmd == "dragloop")
        {
            int offX = int.Parse(args[2]);
            int offY = int.Parse(args[3]);
            while (true)
            {
                if ((GetAsyncKeyState(0x01) & 0x8000) == 0) break;
                if (!IsWindow(h)) break;
                POINT p;
                GetCursorPos(out p);
                SetWindowPos(h, IntPtr.Zero, p.X - offX, p.Y - offY, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                Thread.Sleep(16);
            }
            Console.WriteLine("{\"ok\":true}");
        }
        else
        {
            Console.WriteLine("{\"ok\":false,\"message\":\"unknown cmd\"}");
        }
    }
}
'@

Set-Content -Path $csPath -Value $cs -Encoding ASCII

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:exe /out:$exePath $csPath
if (Test-Path $exePath) {
    Write-Host ("built: " + $exePath + " (" + (Get-Item $exePath).Length + " bytes)")
} else {
    Write-Error 'build failed'
}
