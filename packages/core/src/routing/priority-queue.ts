/** Minimal binary min-heap keyed by a number. */
export class PriorityQueue<T> {
  private readonly items: T[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    this.siftUp(this.items.length - 1);
  }

  /** Removes and returns the item with the smallest key. */
  pop(): T | undefined {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastKey = this.keys.pop();
    if (this.items.length > 0 && lastItem !== undefined && lastKey !== undefined) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.key(parent) <= this.key(i)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(index: number): void {
    let i = index;
    const n = this.items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.key(left) < this.key(smallest)) smallest = left;
      if (right < n && this.key(right) < this.key(smallest)) smallest = right;
      if (smallest === i) return;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private key(i: number): number {
    return this.keys[i] ?? Number.POSITIVE_INFINITY;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b] as T, this.items[a] as T];
    [this.keys[a], this.keys[b]] = [this.key(b), this.key(a)];
  }
}
