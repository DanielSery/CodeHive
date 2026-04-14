Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinJob {
    const int JobObjectBasicLimitInformation = 2;
    const uint BreakawayOk = 0x00000800;
    [StructLayout(LayoutKind.Sequential)]
    struct Info {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, ref Info info, uint infoLen, ref uint returnLen);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, ref Info info, uint infoLen);
    public static int EnableBreakaway() {
        var info = new Info();
        uint ret = 0;
        if (!QueryInformationJobObject(IntPtr.Zero, JobObjectBasicLimitInformation, ref info,
                (uint)Marshal.SizeOf(info), ref ret))
            return Marshal.GetLastWin32Error();
        if ((info.LimitFlags & BreakawayOk) != 0)
            return 0; // already set
        info.LimitFlags |= BreakawayOk;
        if (!SetInformationJobObject(IntPtr.Zero, JobObjectBasicLimitInformation, ref info,
                (uint)Marshal.SizeOf(info)))
            return Marshal.GetLastWin32Error();
        return 0;
    }
}
'@
exit [WinJob]::EnableBreakaway()
