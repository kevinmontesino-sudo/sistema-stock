declare module "qz-tray" {
  const qz: {
    websocket: { isActive(): boolean; connect(opts?: { retries?: number; delay?: number }): Promise<void> };
    printers: { find(query?: string): Promise<string | string[]> };
    configs: { create(printer: string, opts?: Record<string, unknown>): unknown };
    print(config: unknown, data: { type: string; format: string; flavor: string; data: string }[]): Promise<void>;
  };
  export default qz;
}
