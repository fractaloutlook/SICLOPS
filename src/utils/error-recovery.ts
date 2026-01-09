/**
 * Error Recovery - Retry failed operations with exponential backoff
 */

export interface RetryConfig {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay for retry attempt using exponential backoff
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
    const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
    return Math.min(delay, config.maxDelayMs);
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
    operationName: string = 'operation'
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt === config.maxRetries) {
                // Final attempt failed
                break;
            }

            const delay = calculateDelay(attempt, config);
            console.log(`\n⚠️  ${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1})`);
            console.log(`   Error: ${lastError.message}`);
            console.log(`   Retrying in ${delay}ms...\n`);

            await sleep(delay);
        }
    }

    throw new Error(`${operationName} failed after ${config.maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Check if an error is retryable (vs fatal)
 */
export function isRetryableError(error: Error): boolean {
    const retryablePatterns = [
        /timeout/i,
        /network/i,
        /ECONNREFUSED/i,
        /ENOTFOUND/i,
        /rate limit/i,
        /429/,
        /503/,
        /504/,
        /temporarily unavailable/i
    ];

    const errorMessage = error.message;
    return retryablePatterns.some(pattern => pattern.test(errorMessage));
}

/**
 * Retry only if error is retryable, otherwise throw immediately
 */
export async function retryIfRetryable<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
    operationName: string = 'operation'
): Promise<T> {
    try {
        return await retryWithBackoff(operation, config, operationName);
    } catch (error) {
        if (error instanceof Error && !isRetryableError(error)) {
            // Fatal error - don't retry
            console.log(`\n❌ Fatal error in ${operationName}: ${error.message}`);
            console.log(`   Not retrying (error is not transient)\n`);
            throw error;
        }
        throw error;
    }
}

/**
 * Circuit breaker - stops trying after too many consecutive failures
 */
export class CircuitBreaker {
    private failureCount = 0;
    private lastFailureTime?: number;
    private isOpen = false;

    constructor(
        private maxFailures: number = 5,
        private resetTimeoutMs: number = 60000 // 1 minute
    ) {}

    async execute<T>(operation: () => Promise<T>, operationName: string = 'operation'): Promise<T> {
        // Check if circuit is open
        if (this.isOpen) {
            const timeSinceFailure = Date.now() - (this.lastFailureTime || 0);
            if (timeSinceFailure < this.resetTimeoutMs) {
                throw new Error(`Circuit breaker OPEN for ${operationName} - too many failures. Try again in ${Math.ceil((this.resetTimeoutMs - timeSinceFailure) / 1000)}s`);
            } else {
                // Reset timeout elapsed - try half-open
                console.log(`\n🔄 Circuit breaker half-open - attempting ${operationName}...\n`);
                this.isOpen = false;
            }
        }

        try {
            const result = await operation();
            // Success - reset failure count
            this.failureCount = 0;
            return result;
        } catch (error) {
            this.failureCount++;
            this.lastFailureTime = Date.now();

            if (this.failureCount >= this.maxFailures) {
                this.isOpen = true;
                console.log(`\n🚨 Circuit breaker OPENED for ${operationName} after ${this.failureCount} failures\n`);
            }

            throw error;
        }
    }

    reset(): void {
        this.failureCount = 0;
        this.isOpen = false;
        this.lastFailureTime = undefined;
    }

    getStatus(): { isOpen: boolean; failureCount: number; lastFailureTime?: number } {
        return {
            isOpen: this.isOpen,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime
        };
    }
}

/**
 * Batch retry - retry multiple operations, collecting successes and failures
 */
export async function retryBatch<T>(
    operations: Array<() => Promise<T>>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{
    successes: T[];
    failures: Array<{ index: number; error: Error }>;
}> {
    const results = await Promise.allSettled(
        operations.map((op, idx) =>
            retryWithBackoff(op, config, `operation ${idx + 1}`)
        )
    );

    const successes: T[] = [];
    const failures: Array<{ index: number; error: Error }> = [];

    results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
            successes.push(result.value);
        } else {
            failures.push({
                index: idx,
                error: result.reason instanceof Error ? result.reason : new Error(String(result.reason))
            });
        }
    });

    return { successes, failures };
}
