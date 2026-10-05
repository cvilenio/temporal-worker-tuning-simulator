# Temporal Worker Scaling Simulator

Browser-based simulation for learning how Temporal Worker Pollers, Slots, and CPU capacity affect Task throughput and queue growth.

The current vertical slice models Workflow starts, sequential Workflow and Activity Tasks, Temporal Service scheduling, separate Task Queues, Poller dispatch, Slot occupancy, completion signals, and shared CPU-bound execution.

## Run locally

```text
npm install
npm run dev
```

Open the URL printed by Vite.

## Verify

```text
npm test
npm run build
```

## Repository setup

```text
git config core.hooksPath .githooks
```

This enables the sensitive-content pre-commit hook described in [`CONTRIBUTING.md`](CONTRIBUTING.md).
