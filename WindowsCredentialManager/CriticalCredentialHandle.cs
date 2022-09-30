using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace WindowsCredentialManager
{
    public class CriticalCredentialHandle : CriticalHandleZeroOrMinusOneIsInvalid
    {
        internal CriticalCredentialHandle(IntPtr preexistingHandle)
        {
            SetHandle(preexistingHandle);
        }

        internal Credential GetCredential()
        {
            if (!IsInvalid)
            {
                // Get the Credential from the mem location
                NativeCredential nativeCredential = (NativeCredential)Marshal.PtrToStructure(handle, typeof(NativeCredential));

                Credential credential = new Credential()
                {
                    Type = nativeCredential.Type,
                    Flags = nativeCredential.Flags,
                    Persist = (CredPersist)nativeCredential.Persist,
                    UserName = Marshal.PtrToStringUni(nativeCredential.UserName),
                    TargetName = Marshal.PtrToStringUni(nativeCredential.TargetName),
                    TargetAlias = Marshal.PtrToStringUni(nativeCredential.TargetAlias),
                    Comment = Marshal.PtrToStringUni(nativeCredential.Comment),
                    PaswordSize = nativeCredential.CredentialBlobSize,
                    LastWritten = nativeCredential.LastWritten.ToDateTime()
                };

                if (0 < nativeCredential.CredentialBlobSize)
                {
                    credential.Password = Marshal.PtrToStringUni(nativeCredential.CredentialBlob, (int)nativeCredential.CredentialBlobSize / 2);
                }

                return credential;
            }
            else
            {
                throw new InvalidOperationException("Invalid CriticalHandle!");
            }
        }

        protected override bool ReleaseHandle()
        {
            // If the handle was set, free it. Return success.
            if (!IsInvalid)
            {
                // NOTE: We should also ZERO out the memory allocated to the handle, before free'ing it
                // so there are no traces of the sensitive data left in memory.
                NativeMethods.CredFree(handle);
                // Mark the handle as invalid for future users.
                SetHandleAsInvalid();
                return true;
            }
            // Return false. 
            return false;
        }

        public Credential[] GetCredentials(int count)
        {
            if (IsInvalid)
            {
                throw new InvalidOperationException("Invalid CriticalHandle!");
            }

            Credential[] credentials = new Credential[count];
            for (int inx = 0; inx < count; inx++)
            {
                IntPtr pCred = Marshal.ReadIntPtr(handle, inx * IntPtr.Size);
                NativeCredential nativeCredential = (NativeCredential)Marshal.PtrToStructure(pCred, typeof(NativeCredential));
                Credential credential = new Credential()
                {
                    Type = nativeCredential.Type,
                    Flags = nativeCredential.Flags,
                    Persist = (CredPersist)nativeCredential.Persist,
                    UserName = Marshal.PtrToStringUni(nativeCredential.UserName),
                    TargetName = Marshal.PtrToStringUni(nativeCredential.TargetName),
                    TargetAlias = Marshal.PtrToStringUni(nativeCredential.TargetAlias),
                    Comment = Marshal.PtrToStringUni(nativeCredential.Comment),
                    PaswordSize = nativeCredential.CredentialBlobSize,
                    LastWritten = nativeCredential.LastWritten.ToDateTime()
                };

                if (0 < nativeCredential.CredentialBlobSize)
                {
                    credential.Password = Marshal.PtrToStringUni(nativeCredential.CredentialBlob, (int)nativeCredential.CredentialBlobSize / 2);
                }

                credentials[inx] = credential;
            }
            return credentials;
        }
    }
}
