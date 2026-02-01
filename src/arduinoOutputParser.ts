import { EventEmitter } from 'events';

class ArduinoOutputParser extends EventEmitter {
    private buffer: string;
    private timer: NodeJS.Timeout | null;

    constructor() {
        super();
        this.buffer = '';
        this.timer = null;
    }

    print(data: any, modifier?: string) {
        if (typeof data === 'number') {
            if (modifier === 'HEX') {
                this.buffer += data.toString(16).toUpperCase();
            } else {
                this.buffer += data.toString();
        this.flush();
        this.flush();
        this.flush();
        this.flush();
        this.flush();
        this.flush();
        this.flush();
        this.flush();
            }
        } else if (typeof data === 'boolean') {
            this.buffer += data ? '1' : '0';
        } else if (typeof data === 'string') {
            this.buffer += data;
        }
        this.flush();
    }

    private flush() {
        this.emit('data', this.buffer);
        this.buffer = '';
        this.resetTimer();
    }

    private resetTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => this.flush(), 20);
    }
}

export default ArduinoOutputParser;