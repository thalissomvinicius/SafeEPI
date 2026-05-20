declare module "lru-cache" {
  type Options = {
    max?: number
    maxAge?: number
  }

  export default class LRUCache<K, V> {
    constructor(options?: Options)
    get(key: K): V | undefined
    set(key: K, value: V, maxAge?: number): boolean
  }
}
