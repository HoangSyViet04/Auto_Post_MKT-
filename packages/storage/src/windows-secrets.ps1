$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.operation -eq 'secure_directory') {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    foreach ($identity in @($sid, $systemSid)) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', $inherit, 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($request.path, $acl)
    $actual = [System.IO.Directory]::GetAccessControl($request.path)
    $rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    if (-not $actual.AreAccessRulesProtected -or @($rules).Count -ne 2) { throw 'ACL check failed' }
    foreach ($rule in $rules) {
      if ($rule.IdentityReference.Value -notin @($sid.Value, $systemSid.Value) -or $rule.AccessControlType -ne 'Allow') { throw 'ACL check failed' }
    }
    @{ ok = $true; protected = $true } | ConvertTo-Json -Compress
  } else {
    Add-Type -AssemblyName System.Security
    $bytes = [Convert]::FromBase64String($request.value)
    $entropy = [Text.Encoding]::UTF8.GetBytes('AutoPostMKT/secrets/v1/' + $request.context)
    $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($request.operation -eq 'protect') {
      $result = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
    } elseif ($request.operation -eq 'unprotect') {
      $result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope)
    } else { throw 'Unsupported operation' }
    @{ ok = $true; value = [Convert]::ToBase64String($result) } | ConvertTo-Json -Compress
    [Array]::Clear($bytes, 0, $bytes.Length)
    [Array]::Clear($result, 0, $result.Length)
  }
} catch {
  # Never echo exception, input, path or plaintext to stderr/stdout.
  [Console]::Out.Write('{"ok":false}')
  exit 1
}
