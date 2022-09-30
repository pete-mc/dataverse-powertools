using System;
using System.Collections.Generic;
using System.Text;

namespace WindowsCredentialManager
{
    public enum CredType : uint
    {
        Generic = 1,
        DomainPassword = 2,
        DomainCertificate = 3,
        DomainVisiblePassword = 4,
        GenericCertificate = 5,
        DomainExtended = 6,
        Maximum = 7,      // Maximum supported cred type
        MaximumEx = (Maximum + 1000),  // Allow new applications to run on old OSes
    }
}
