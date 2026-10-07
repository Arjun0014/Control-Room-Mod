// Reads and drives a Windows console (conhost) from outside: the screen as text, and
// keyboard and SGR mouse input, for checking Control Room's terminal UI. See README.md.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class ConDrive
{
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);

    [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
    [StructLayout(LayoutKind.Sequential)] public struct SMALL_RECT { public short Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct CSBI { public COORD Size; public COORD Cursor; public ushort Attr; public SMALL_RECT Window; public COORD MaxSize; }

    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ReadConsoleOutputCharacterW(IntPtr h, [Out] char[] buf, uint len, COORD at, out uint read);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ReadConsoleOutputAttribute(IntPtr h, [Out] ushort[] buf, uint len, COORD at, out uint read);

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    public struct INPUT_RECORD
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public int bKeyDown;
        [FieldOffset(8)] public ushort wRepeatCount;
        [FieldOffset(10)] public ushort wVirtualKeyCode;
        [FieldOffset(12)] public ushort wVirtualScanCode;
        [FieldOffset(14)] public char UnicodeChar;
        [FieldOffset(16)] public uint dwControlKeyState;
    }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] recs, uint len, out uint written);

    const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000, SHARE_RW = 3, OPEN_EXISTING = 3;

    static void Attach(uint pid)
    {
        FreeConsole();
        if (!AttachConsole(pid)) throw new Exception("AttachConsole failed: " + Marshal.GetLastWin32Error());
    }

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);

    /// Saves the console window as a PNG, as drawn (even when other windows cover it).
    /// `cells` crops to "col,row,width,height" in 1-based character cells; empty keeps it whole.
    public static void Capture(uint pid, string path, string cells)
    {
        Attach(pid);
        IntPtr hwnd = GetConsoleWindow();
        if (hwnd == IntPtr.Zero) throw new Exception("no console window");
        RECT rc;
        GetClientRect(hwnd, out rc);
        int w = rc.Right - rc.Left, h = rc.Bottom - rc.Top;
        IntPtr outh = CreateFileW("CONOUT$", GENERIC_READ | GENERIC_WRITE, SHARE_RW, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        CSBI info;
        GetConsoleScreenBufferInfo(outh, out info);
        CloseHandle(outh);
        int cols = info.Window.Right - info.Window.Left + 1, rows = info.Window.Bottom - info.Window.Top + 1;
        using (var shot = new System.Drawing.Bitmap(w, h))
        {
            using (var g = System.Drawing.Graphics.FromImage(shot))
            {
                IntPtr hdc = g.GetHdc();
                // PW_CLIENTONLY | PW_RENDERFULLCONTENT
                PrintWindow(hwnd, hdc, 3);
                g.ReleaseHdc(hdc);
            }
            System.Drawing.Rectangle area = new System.Drawing.Rectangle(0, 0, w, h);
            if (!string.IsNullOrEmpty(cells))
            {
                string[] p = cells.Split(',');
                double cw = (double)w / cols, ch = (double)h / rows;
                int x = (int)Math.Round((int.Parse(p[0]) - 1) * cw), y = (int)Math.Round((int.Parse(p[1]) - 1) * ch);
                area = new System.Drawing.Rectangle(x, y, Math.Min(w - x, (int)Math.Round(int.Parse(p[2]) * cw)), Math.Min(h - y, (int)Math.Round(int.Parse(p[3]) * ch)));
            }
            using (var crop = shot.Clone(area, shot.PixelFormat)) crop.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        }
    }

    /// Returns the visible window as text; with attrs, a second grid follows:
    /// fg colour as a hex digit, '#' where reverse video (0x4000), '_' underline (0x8000).
    public static string Read(uint pid, bool attrs, bool wholeBuffer)
    {
        Attach(pid);
        IntPtr h = CreateFileW("CONOUT$", GENERIC_READ | GENERIC_WRITE, SHARE_RW, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        try
        {
            CSBI info;
            if (!GetConsoleScreenBufferInfo(h, out info)) throw new Exception("GetConsoleScreenBufferInfo failed: " + Marshal.GetLastWin32Error());
            int width = info.Size.X;
            int top = wholeBuffer ? 0 : info.Window.Top;
            int bottom = wholeBuffer ? info.Size.Y - 1 : info.Window.Bottom;
            var sb = new StringBuilder();
            sb.AppendFormat("# buffer {0}x{1} window {2}..{3} cursor {4},{5}\n", info.Size.X, info.Size.Y, info.Window.Top, info.Window.Bottom, info.Cursor.X, info.Cursor.Y);
            var text = new List<string>();
            var grid = new List<string>();
            for (int y = top; y <= bottom; y++)
            {
                var buf = new char[width];
                uint n;
                COORD at; at.X = 0; at.Y = (short)y;
                ReadConsoleOutputCharacterW(h, buf, (uint)width, at, out n);
                text.Add(new string(buf).TrimEnd());
                if (attrs)
                {
                    var a = new ushort[width];
                    ReadConsoleOutputAttribute(h, a, (uint)width, at, out n);
                    var g = new char[width];
                    for (int x = 0; x < width; x++)
                    {
                        ushort v = a[x];
                        g[x] = (v & 0x4000) != 0 ? '#' : (v & 0x8000) != 0 ? '_' : "0123456789abcdef"[v & 0xF];
                    }
                    grid.Add(new string(g));
                }
            }
            for (int i = 0; i < text.Count; i++) sb.AppendFormat("{0,2}|{1}\n", i + 1, text[i]);
            if (attrs)
            {
                sb.Append("# attrs\n");
                for (int i = 0; i < grid.Count; i++) sb.AppendFormat("{0,2}|{1}\n", i + 1, grid[i]);
            }
            return sb.ToString();
        }
        finally { CloseHandle(h); FreeConsole(); }
    }

    static INPUT_RECORD Key(bool down, ushort vk, char ch, uint ctrl)
    {
        var r = new INPUT_RECORD();
        r.EventType = 1; r.bKeyDown = down ? 1 : 0; r.wRepeatCount = 1; r.wVirtualKeyCode = vk; r.UnicodeChar = ch; r.dwControlKeyState = ctrl;
        return r;
    }

    static void Press(List<INPUT_RECORD> list, ushort vk, char ch, uint ctrl)
    {
        list.Add(Key(true, vk, ch, ctrl));
        list.Add(Key(false, vk, ch, ctrl));
    }

    /// Tokens separated by '|': text:<chars>, enter, tab, stab (shift+tab), esc, up, down, left, right,
    /// space, bs, click:<col>,<row> (1-based, SGR mouse press and release), wait:<ms>.
    public static void Send(uint pid, string spec)
    {
        Attach(pid);
        IntPtr h = CreateFileW("CONIN$", GENERIC_READ | GENERIC_WRITE, SHARE_RW, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        try
        {
            foreach (var raw in spec.Split('|'))
            {
                var tok = raw;
                var list = new List<INPUT_RECORD>();
                if (tok.StartsWith("text:")) foreach (var c in tok.Substring(5)) Press(list, 0, c, 0);
                else if (tok == "enter") Press(list, 0x0D, '\r', 0);
                else if (tok == "tab") Press(list, 0x09, '\t', 0);
                else if (tok == "stab") Press(list, 0x09, '\t', 0x0010);
                else if (tok == "esc") Press(list, 0x1B, (char)0x1B, 0);
                else if (tok == "space") Press(list, 0x20, ' ', 0);
                else if (tok == "bs") Press(list, 0x08, (char)0x08, 0);
                else if (tok == "up") Press(list, 0x26, (char)0, 0x0100);
                else if (tok == "down") Press(list, 0x28, (char)0, 0x0100);
                else if (tok == "left") Press(list, 0x25, (char)0, 0x0100);
                else if (tok == "right") Press(list, 0x27, (char)0, 0x0100);
                else if (tok.StartsWith("click:"))
                {
                    var p = tok.Substring(6).Split(',');
                    foreach (var c in "\x1b[<0;" + p[0] + ";" + p[1] + "M") Press(list, 0, c, 0);
                    foreach (var c in "\x1b[<0;" + p[0] + ";" + p[1] + "m") Press(list, 0, c, 0);
                }
                else if (tok.StartsWith("wheel:"))
                {
                    // wheel:<up|down>,<col>,<row>
                    var p = tok.Substring(6).Split(',');
                    var b = p[0] == "up" ? "64" : "65";
                    foreach (var c in "\x1b[<" + b + ";" + p[1] + ";" + p[2] + "M") Press(list, 0, c, 0);
                }
                else if (tok.StartsWith("wait:")) { Thread.Sleep(int.Parse(tok.Substring(5))); continue; }
                else throw new Exception("unknown token: " + tok);
                uint w;
                if (!WriteConsoleInputW(h, list.ToArray(), (uint)list.Count, out w)) throw new Exception("WriteConsoleInputW failed: " + Marshal.GetLastWin32Error());
                Thread.Sleep(40);
            }
        }
        finally { CloseHandle(h); FreeConsole(); }
    }
}
