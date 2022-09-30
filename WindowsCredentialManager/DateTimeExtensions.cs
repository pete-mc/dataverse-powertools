using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace WindowsCredentialManager
{
    public static class DateTimeExtensions
    {
        public static FILETIME ToComFileTime(this DateTime dateTime)
        {
            return new FILETIME()
            {
                dwLowDateTime = (int)(dateTime.ToFileTime() & 0xFFFFFFFF),
                dwHighDateTime = (int)(dateTime.ToFileTime() >> 32)
            };
        }
    }
}
