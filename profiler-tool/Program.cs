using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.WebServiceClient;
using Microsoft.Xrm.Tooling.Connector;
using PluginProfiler.Library;

// Dataverse PowerTools plugin-profiler capture tool (net48, Windows-only).
//
// Commands (all authenticate with the DVPT_TOKEN env var — the extension's own
// access token — so they work under service-principal AND interactive auth):
//
//   enable  --url <org> --step <guid> [--max <n>]
//       Start Profiling the given plugin step (PRT's "Install Profiler" must have
//       run once; the extension ensures that). Prints {"ok":true,"profilerStepId":...}.
//
//   disable --url <org> --profiler-step <guid>
//       Stop Profiling (removes the profiler step, re-enables the original).
//
// Output is a single JSON line on stdout so the extension can parse it reliably;
// human-readable progress goes to stderr.
namespace DvptPluginProfiler
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    return Fail("no command (expected: enable | disable)");
                }
                var command = args[0].ToLowerInvariant();
                var opts = ParseOptions(args);

                var url = Require(opts, "url");
                var token = Environment.GetEnvironmentVariable("DVPT_TOKEN");
                if (string.IsNullOrEmpty(token))
                {
                    return Fail("DVPT_TOKEN environment variable is not set");
                }

                using (var service = Connect(url, token))
                {
                    if (!service.IsReady)
                    {
                        return Fail("connection failed: " + service.LastCrmError);
                    }

                    switch (command)
                    {
                        case "enable":
                            return Enable(service, opts);
                        case "disable":
                            return Disable(service, opts);
                        default:
                            return Fail("unknown command '" + command + "' (expected: enable | disable)");
                    }
                }
            }
            catch (Exception ex)
            {
                return Fail(ex.GetType().Name + ": " + ex.Message);
            }
        }

        // Raw-token auth: the PRT-era connector has no token constructor, so wrap an
        // OrganizationWebProxyClient carrying the extension's bearer token.
        private static CrmServiceClient Connect(string url, string token)
        {
            var webEndpoint = new Uri(url.TrimEnd('/') + "/XRMServices/2011/Organization.svc/web");
            var proxy = new OrganizationWebProxyClient(webEndpoint, true) { HeaderToken = token };
            return new CrmServiceClient(proxy);
        }

        private static int Enable(CrmServiceClient service, IDictionary<string, string> opts)
        {
            var stepId = RequireGuid(opts, "step");
            int? max = 100;
            if (opts.TryGetValue("max", out var maxStr) && int.TryParse(maxStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
            {
                max = parsed;
            }
            Console.Error.WriteLine($"[profiler] Start Profiling step {stepId} (persist, max={max})");
            var profilerStepId = ProfilerManagementUtility.EnablePlugin(service, stepId, true, null, max, false);
            return Ok(new Dictionary<string, object> { { "profilerStepId", profilerStepId.ToString() } });
        }

        private static int Disable(CrmServiceClient service, IDictionary<string, string> opts)
        {
            var profilerStepId = RequireGuid(opts, "profiler-step");
            Console.Error.WriteLine($"[profiler] Stop Profiling (profiler step {profilerStepId})");
            ProfilerManagementUtility.DisablePlugin(service, profilerStepId);
            return Ok(new Dictionary<string, object> { { "disabled", true } });
        }

        // --- helpers -------------------------------------------------------------

        private static IDictionary<string, string> ParseOptions(string[] args)
        {
            var opts = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var i = 1; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--", StringComparison.Ordinal))
                {
                    continue;
                }
                var key = args[i].Substring(2);
                var value = i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal) ? args[++i] : "true";
                opts[key] = value;
            }
            return opts;
        }

        private static string Require(IDictionary<string, string> opts, string key)
        {
            if (!opts.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("missing required option --" + key);
            }
            return value;
        }

        private static Guid RequireGuid(IDictionary<string, string> opts, string key)
        {
            return Guid.Parse(Require(opts, key));
        }

        private static int Ok(IDictionary<string, object> fields)
        {
            fields["ok"] = true;
            Console.WriteLine(ToJson(fields));
            return 0;
        }

        private static int Fail(string message)
        {
            Console.WriteLine(ToJson(new Dictionary<string, object> { { "ok", false }, { "error", message } }));
            Console.Error.WriteLine("[profiler] ERROR: " + message);
            return 1;
        }

        // Minimal JSON writer (avoids a dependency on a specific Newtonsoft version
        // in the PRT folder). Handles the string/bool/number values we emit.
        private static string ToJson(IDictionary<string, object> fields)
        {
            var sb = new StringBuilder("{");
            var first = true;
            foreach (var kv in fields)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append('"').Append(Escape(kv.Key)).Append("\":");
                switch (kv.Value)
                {
                    case bool b:
                        sb.Append(b ? "true" : "false");
                        break;
                    case int n:
                        sb.Append(n.ToString(CultureInfo.InvariantCulture));
                        break;
                    default:
                        sb.Append('"').Append(Escape(kv.Value?.ToString() ?? string.Empty)).Append('"');
                        break;
                }
            }
            return sb.Append('}').ToString();
        }

        private static string Escape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r");
        }
    }
}
