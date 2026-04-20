# 17. pi-pods — rolling your own vLLM

pi-pods is the smallest of the satellite packages and the most
"shell script wearing a suit." It exists because the author wanted
to run open-weight models on rented GPUs and didn't want to remember
the vLLM command-line flags every time.

## What it is

A CLI that SSHes into GPU machines you already have, starts vLLM
processes on them, and keeps a local registry of which models are
running where. That's it. No Kubernetes, no cloud API integration,
no orchestrator — it's `ssh` with a config file.

Supported targets: anything with SSH access. Runpod, Lambda Labs,
Vast.ai, your own rack, a colo — pi-pods doesn't know or care. You
give it an SSH command string and it uses that.

## The architecture

```
~/.pi/pods.json              (config, on your laptop)
     │
     │  pods.runpod-h200.ssh = "ssh -i key.pem user@ip"
     │  pods.runpod-h200.gpus = [...]
     │  pods.runpod-h200.models = { llama-70b: { port: 8001, pid, ... } }
     │
pi start llama-70b           (on your laptop)
     │
     ├─ reads pods.json
     ├─ picks a pod (default: "active" pod)
     ├─ picks GPUs (round-robin by current usage)
     ├─ builds vLLM args
     └─ ssh <pod> "nohup python -m vllm.entrypoints.openai.api_server ..."
         │
         ▼
     remote host spawns vLLM
     updates pods.json with the new running-model entry
```

No daemon on your laptop. Each `pi-pods` invocation is stateless
except for reads/writes to `pods.json`. No daemon on the remote
either — vLLM just runs as a detached `nohup` process with its PID
tracked.

## Setting up a pod

```sh
pi pods setup my-pod "ssh -i key.pem user@1.2.3.4" --mount "/path/to/models"
```

The setup command (`commands/pods.ts`):

1. Validates SSH connectivity (`ssh <pod> echo ok`).
2. Runs `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader`
   to detect GPUs.
3. Optionally runs a mount command if `--mount` is given.
4. Writes the pod entry to `~/.pi/pods.json`.

The GPU detection output becomes the pod's `gpus` array:

```json
[
  { "id": 0, "name": "NVIDIA H200", "memory": "141GB" },
  { "id": 1, "name": "NVIDIA H200", "memory": "141GB" }
]
```

## Starting a model

```sh
pi start meta-llama/Llama-3-70B-Instruct
```

`commands/models.ts` looks up the model in its database (`models.json`,
loaded via `model-configs.ts`), which knows things like:

- Template name for vLLM.
- Required GPU count (a 70B parameter model needs 2× H200).
- Recommended flags (`--gpu-memory-utilization`,
  `--tensor-parallel-size`, `--max-model-len`).

It picks GPUs via round-robin: count current model usage per GPU,
assign to the least-loaded GPU(s) that can fit. If nothing fits, it
errors.

Then it SSHes this:

```sh
nohup python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3-70B-Instruct \
  --port 8001 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.9 \
  > logs/model.log 2>&1 &
```

Captures the PID via `ps`, saves it to `pods.json`, prints the
endpoint URL (`http://<pod-ip>:8001/v1`).

## The model catalog

`model-configs.ts` contains a hard-coded list of models and their
default configurations. Each entry looks roughly like:

```ts
{
  name: "llama-3-70b",
  huggingFaceId: "meta-llama/Llama-3-70B-Instruct",
  minGpus: 2,
  maxContextLen: 8192,
  extraArgs: ["--quantization", "awq"],
  family: "llama",
}
```

Add a new model = add a new entry. The list covers the common
open-weight families (Llama, Qwen, Mistral, Mixtral, Yi, DeepSeek,
GPT-OSS, and a scattering of fine-tunes).

vLLM version selection: pods supports three toggles —
`"release"` (stable), `"nightly"` (main branch), `"gpt-oss"` (a
specific fork needed for some models). Per-pod configuration.

## Status and logs

```sh
pi list
pi logs my-pod
```

`list` enumerates running models across all pods (data straight from
`pods.json`). `logs <pod>` opens an SSH tunnel and `tail -f`s the
model's log file.

## Stopping a model

```sh
pi stop my-pod
```

SSHes `kill <pid>` on the pod and removes the entry from
`pods.json`. No grace period, no clean shutdown — vLLM handles
SIGTERM fine in practice.

## Hooking up to pi-ai

pi-pods does not auto-register its endpoints with pi-ai. After
starting a model, you get an endpoint URL and manually add it as a
custom provider:

```ts
// via an extension, or the web UI's custom provider dialog
registerProvider({
  name: "my-pod-llama-70b",
  baseUrl: "http://1.2.3.4:8001/v1",
  apiKey: "dummy",  // vLLM requires a key but accepts any
  type: "openai-compatible",
});
```

From there, pi-ai treats it like any other OpenAI-compatible
provider. The coding agent can use it; the web UI can use it; any
pi-ai consumer can use it.

## The `pi agent` shortcut

One convenience (`cli.ts:328-350`):

```sh
pi agent my-pod
```

Starts an interactive pi session pre-configured with the pod's
running model as the provider. Handy for quickly chatting with a
model you just spun up.

## The ssh.ts helper

`src/ssh.ts` wraps `child_process.spawn("ssh", ...)` with:

- `sshExec(pod, command)` — capture stdout/stderr, return exit code.
- `sshExecStream(pod, command, { onData })` — stream output.
- `sshCopy(pod, localPath, remotePath)` — scp wrapper.

Nothing fancy. The whole file is under 100 lines.

## What it's not

- Not a hosted service. You bring the machine.
- Not a model fine-tuner. It spins up vLLM for inference only.
- Not a secrets manager. The SSH key path is stored literally in
  `pods.json`; protect the file accordingly.

## In one paragraph

Pods is a thin CLI that keeps a `pods.json` registry of GPU
machines and the models running on them, SSHes into those machines
to spawn `nohup`-detached vLLM processes, tracks PIDs and ports,
and lets you list, log, and stop them. It doesn't integrate with
cloud APIs or pi-ai automatically — you add endpoints as custom
providers after starting them. The whole package is ~3 k LOC and
reads like a polished shell script.

That's the seven packages. Part V covers adding to pi-mono:
providers, tests, releases.
