# Windows PowerShell deployment transport verification

Date: 2026-10-28 (Asia/Shanghai)

## Scope and result

Verified the config-generation and LLBot HTTP POST transport fixes on the
Windows device `zetam@192.168.10.11` through SSH.

| Runtime | Native argument mode | Result |
| --- | --- | --- |
| Windows PowerShell 5.1.26100.9711 | Legacy | 7 passed |
| PowerShell 7.6.6 | Legacy | 7 passed |
| PowerShell 7.6.6 | Standard | 7 passed |
| PowerShell 7.6.6 | Windows (Windows default mode) | 7 passed |

The device uses Node.js v24.16.0 and the Windows system `curl.exe`.
PowerShell versions before 7.3 run only the Legacy test group because they do
not implement the newer native argument modes.

## Original failure

Running the original argument pattern under Windows PowerShell 5.1:

```powershell
$nodeScript = 'const { run } = require("/app/src/cli/config")'
& node -e $nodeScript
```

Exited with code 1. Node received:

```javascript
const { run } = require(/app/src/cli/config)
```

The error matched the reported screenshot:

```text
Unknown regular expression flags.
SyntaxError: Invalid regular expression flags
```

## Fix and verification method

- Config generation sends source through stdin to `docker run --rm -i` with
  `node -`. Serialized config input is encoded as UTF-8 Base64 inside that
  source, so neither source quotes nor user-provided secrets travel as native
  command-line arguments.
- LLBot POST sends the JSON body through stdin to `curl.exe --data-binary @-`.
- Each test group checks all four QQ implementation choices, quoted and
  non-ASCII input, spaces and backslashes, empty optional values, config input
  file mode, CLI arguments, and propagation of a failing Docker exit status.
- The Docker replacement is a native executable that captures arguments and
  stdin after PowerShell performs native argument conversion. The captured
  JavaScript is executed in a Node VM with controlled filesystem/Config CLI
  adapters, and the decoded input and CLI invocation are checked.
- The HTTP tests use the real Windows `curl.exe` against a temporary local
  HTTP server and check the received JSON, HTTP method, path, and headers.

## Reproduction

The isolated remote test workspace is:

```text
C:\Users\ZetaM\AppData\Local\Temp\bili-qq-compat-fcddf44a9d0b46758357393fb687354b
```

It contains copies of `setup.ps1`, the regression test, and the existing local
Mocha dependencies. No software installation, service change, or Git operation
was performed on the Windows device.

Run from that directory:

```powershell
$env:PWSH = (Get-Command powershell.exe).Source
node node_modules/mocha/bin/mocha.js --timeout 30000 test/unit/deployment/setup-powershell.test.js

$env:PWSH = (Get-Command pwsh.exe).Source
node node_modules/mocha/bin/mocha.js --timeout 30000 test/unit/deployment/setup-powershell.test.js
```

The local and remote file hashes matched after the final test run:

```text
setup.ps1
c5a160476e2be911c5be5c57102598d1d30b623d452fcaf3551e1abf54c550b1

test/unit/deployment/setup-powershell.test.js
55f650f1a9554856b392b9f473214f04ca0b74a2d194b64b255cee17afdc0ef6
```

## Verification boundary

No Docker CLI or Docker service was detected on this Windows device. These
results verify actual Windows PowerShell native transport and real HTTP
delivery, but do not verify image pulls, Docker Desktop stdin forwarding,
Linux-container execution of the Config CLI, or the complete deployment/login
flow on Windows.

The earlier local checks also passed: 14 transport tests on macOS with
PowerShell 7.4.13, plus 37 existing Linux setup and Config CLI tests.
