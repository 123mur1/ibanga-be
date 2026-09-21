import { DemoService } from './demo.service';
export declare class DemoController {
    private demo;
    constructor(demo: DemoService);
    reset(): Promise<{
        ok: boolean;
        users: number;
        trucks: number;
    }>;
}
