import {createServer, createConnection} from 'node:net';

import {afterEach, describe, expect, it} from 'vitest';

import {startCli, type RunningCli} from './process-helpers.js';

const running: RunningCli[] = [];

const getFreePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate a local test port.');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};

const isPortOpen = async (port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = createConnection({host: '127.0.0.1', port});
  const finish = (open: boolean) => {
    socket.destroy();
    resolve(open);
  };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
});

const waitForPort = async (port: number): Promise<void> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Studio did not open port ${port} in time.`);
};

const stop = async (process: RunningCli): Promise<void> => {
  if (process.child.exitCode === null && process.child.signalCode === null) {
    process.child.kill('SIGTERM');
  }
  await process.completion;
};

afterEach(async () => {
  await Promise.all(running.splice(0).map(async (process) => {
    try {
      await stop(process);
    } catch {
      // The assertion that owns the process reports its exit failure.
    }
  }));
});

describe('real Studio processes', () => {
  it('rejects a second Studio on the same port with exit code 5', async () => {
    const port = await getFreePort();
    const first = startCli(['studio', '--input', 'examples/vertical-basic', '--port', String(port)]);
    running.push(first);
    await waitForPort(port);

    const second = startCli(['studio', '--input', 'examples/vertical-basic', '--port', String(port)]);
    running.push(second);
    const secondResult = await second.completion;
    expect(secondResult.code, secondResult.stderr).toBe(5);

    await expect(stop(first)).resolves.toBeUndefined();
  }, 90_000);

  it('keeps two Studios live on different ports at the same time', async () => {
    const firstPort = await getFreePort();
    let secondPort = await getFreePort();
    while (secondPort === firstPort) {
      secondPort = await getFreePort();
    }
    const first = startCli(['studio', '--input', 'examples/vertical-basic', '--port', String(firstPort)]);
    const second = startCli(['studio', '--input', 'examples/vertical-basic', '--port', String(secondPort)]);
    running.push(first, second);

    await Promise.all([waitForPort(firstPort), waitForPort(secondPort)]);

    await Promise.all([stop(first), stop(second)]);
  }, 120_000);
});
