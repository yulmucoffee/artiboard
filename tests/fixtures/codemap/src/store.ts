// Keeps records in memory; the cart extends it.
export interface Record {
  id: string;
  save(): void;
}

export abstract class Store<T extends Record> {
  protected items: T[] = [];

  save(item: T): void {
    this.items.push(item);
    this.touch();
  }

  private touch() {
    return this.items.length;
  }

  abstract total(): number;
}
