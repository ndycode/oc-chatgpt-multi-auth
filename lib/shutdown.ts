type CleanupFn = () => void | Promise<void>;

const cleanupFunctions: CleanupFn[] = [];
let shutdownRegistered = false;
let sigintHandler: (() => void) | null = null;
let sigtermHandler: (() => void) | null = null;
let beforeExitHandler: (() => void) | null = null;
let cleanupInFlight: Promise<void> | null = null;
let signalExitPending = false;

export function registerCleanup(fn: CleanupFn): void {
	cleanupFunctions.push(fn);
	ensureShutdownHandler();
}

export function unregisterCleanup(fn: CleanupFn): void {
	const index = cleanupFunctions.indexOf(fn);
	if (index !== -1) {
		cleanupFunctions.splice(index, 1);
	}
}

export function runCleanup(): Promise<void> {
	if (cleanupInFlight) {
		return cleanupInFlight;
	}

	const keepHandlersInstalled = signalExitPending;
	cleanupInFlight = (async () => {
		while (cleanupFunctions.length > 0) {
			const fns = [...cleanupFunctions];
			cleanupFunctions.length = 0;

			for (const fn of fns) {
				try {
					await fn();
				} catch {
					// Ignore cleanup errors during shutdown
				}
			}
		}
	})().finally(() => {
		cleanupInFlight = null;
		if (!keepHandlersInstalled) {
			removeShutdownHandlers();
			shutdownRegistered = false;
		}
		if (cleanupFunctions.length > 0 && !shutdownRegistered) {
			ensureShutdownHandler();
		}
	});

	return cleanupInFlight;
}

function ensureShutdownHandler(): void {
	if (shutdownRegistered) return;
	shutdownRegistered = true;

	const handleSignal = () => {
		if (signalExitPending) {
			return;
		}
		signalExitPending = true;
		void runCleanup().finally(() => {
			process.exit(0);
		});
	};
	sigintHandler = handleSignal;
	sigtermHandler = handleSignal;
	beforeExitHandler = () => {
		if (!cleanupInFlight) {
			void runCleanup();
		}
	};

	process.on("SIGINT", sigintHandler);
	process.on("SIGTERM", sigtermHandler);
	process.on("beforeExit", beforeExitHandler);
}

function removeShutdownHandlers(): void {
	if (sigintHandler) {
		process.off("SIGINT", sigintHandler);
		sigintHandler = null;
	}
	if (sigtermHandler) {
		process.off("SIGTERM", sigtermHandler);
		sigtermHandler = null;
	}
	if (beforeExitHandler) {
		process.off("beforeExit", beforeExitHandler);
		beforeExitHandler = null;
	}
}

export function getCleanupCount(): number {
	return cleanupFunctions.length;
}
