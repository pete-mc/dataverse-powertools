using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace WindowsCredentialManager
{
    public class Programf
    {
        static void Main(string[] args)
        {
            if (args.Length == 4)
            {
                if (args[0] == "New-Credential")
                {
                    string target = args[1].TrimEnd(new[] { '/' });
                    string username = args[2];
                    string password = args[3];
                    CredWrite(target, username, password);
                }
            } 
            else if (args.Length == 3 && args[0] == "Get-Credentials" && args[2] == "password")
            {
                var retrievedCredential = CredRead(args[1].TrimEnd(new[] { '/' }));
                if (retrievedCredential.Password != null)
                {
                    Console.Write(retrievedCredential.Password);
                }
            }
            else if (args.Length == 3 && args[0] == "Get-Credentials" && args[2] == "username")
            {
                var retrievedCredential = CredRead(args[1].TrimEnd(new[] { '/' }));
                if (retrievedCredential.UserName != null)
                {
                    Console.Write(retrievedCredential.UserName);
                }
            }
        }

        public static bool CredWrite(string target, string username, string password)
        {
            Credential credential = new Credential()
            {
                TargetName = target,
                Password = password,
                PaswordSize = (UInt32)Encoding.Unicode.GetBytes(password).Length,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                Comment = "",
                TargetAlias = null,
                Type = CredType.Generic,
                Persist = CredPersist.LocalMachine,
                UserName = username,
                LastWritten = DateTime.Now,
            };



            NativeCredential nativeCredential = new NativeCredential()
            {
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                Comment = Marshal.StringToCoTaskMemUni(credential.Comment),
                TargetAlias = IntPtr.Zero,
                Type = credential.Type,
                Persist = (uint)credential.Persist,
                CredentialBlobSize = credential.PaswordSize,
                TargetName = Marshal.StringToCoTaskMemUni(credential.TargetName),
                CredentialBlob = Marshal.StringToCoTaskMemUni(credential.Password),
                UserName = Marshal.StringToCoTaskMemUni(credential.UserName),
                LastWritten = credential.LastWritten.ToComFileTime()
            };

            return NativeMethods.CredWrite(ref nativeCredential, 0);
        }

        public static Credential CredRead(string target)
        {
            IntPtr nativeCredentialPointer;

            bool read = NativeMethods.CredRead(target, CredType.Generic, 0, out nativeCredentialPointer); 
            if (read)
            {
                using (CriticalCredentialHandle critCred = new CriticalCredentialHandle(nativeCredentialPointer))
                {
                    return critCred.GetCredential();
                }
            } 
            else
            {
                return new Credential();
            }
        }
    }

    class NativeMethods
    {
        [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CredRead([In] string target, [In] CredType type, [In] int reservedFlag, out IntPtr credentialPtr);

        [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CredWrite([In] ref NativeCredential userCredential, [In] UInt32 flags);

        [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
        public static extern bool CredFree([In] IntPtr credentialPointer);

        [DllImport("Advapi32.dll", SetLastError = true, EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode)]
        public static extern bool CredDelete([In] string target, [In] CredType type, [In] int reservedFlag);

        [DllImport("Advapi32.dll", SetLastError = true, EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode)]
        public static extern bool CredEnumerate([In] string filter, [In] int flags, out int count, out IntPtr credentialPtrs);
    }
}
