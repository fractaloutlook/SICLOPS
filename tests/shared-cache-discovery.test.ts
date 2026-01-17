import { SharedMemoryCache } from '../src/memory/shared-cache';

describe('SharedMemoryCache Test Discovery Check', () => {
    let cache: SharedMemoryCache;

    beforeEach(() => {
        cache = new SharedMemoryCache();
    });

    test('should allow basic instantiation', () => {
        expect(cache).toBeInstanceOf(SharedMemoryCache);
    });

    test('should store and retrieve data correctly', () => {
        const key = 'testKey';
        const value = { data: 'testValue' };
        const reason = 'testing basic store';
        cache.store(key, value, reason, 'transient');
        const retrieved = cache.retrieve(key);
        expect(retrieved).toEqual(value);
    });
});
