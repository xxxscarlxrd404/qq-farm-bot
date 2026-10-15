const { createScheduler } = require('./scheduler');

const DEFAULT_PROCESS_INTERVAL_MS = 5000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_SPEED_CHECK_INTERVAL_MS = 30000;
const DEFAULT_STATUS_DELAY_MS = 150000;
const DEFAULT_FUNCTION_CHECK_DELAY_MS = 180000;
const MAX_BACKOFF_MS = 30000;

class AceService {
    constructor(options) {
        this.runtime = options.runtime;
        this.sendRequest = options.sendRequest;
        this.isConnected = options.isConnected;
        this.types = options.types;
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
        this.scheduler = createScheduler(`ace-${this.runtime.accountId}`);
        this.running = false;
        this.inFlight = false;
        this.failures = 0;
        this.uploadCount = 0;
        this.lastUploadAt = 0;
        this.lastError = '';
    }

    start() {
        if (this.running) return;
        if (!this.runtime.ready) throw new Error('Cannot start ACE before TSDK is ready');
        this.running = true;
        this.scheduler.setIntervalTask('process_received_data', DEFAULT_PROCESS_INTERVAL_MS, () => {
            if (!this.running) return;
            try {
                this.runtime.processReceivedData();
            } catch (error) {
                this.lastError = error.message;
                this.logger('warn', `ACE 数据处理失败：${error.message}`);
            }
        });
        this.scheduler.setIntervalTask('heartbeat_tick', DEFAULT_HEARTBEAT_INTERVAL_MS, () => {
            if (!this.running) return;
            try {
                this.runtime.heartbeatTick();
            } catch (error) {
                this.lastError = error.message;
                this.logger('warn', `ACE 心跳失败：${error.message}`);
            }
        });
        let lastSpeedCheckAt = Date.now();
        this.scheduler.setIntervalTask('speed_hack_check', DEFAULT_SPEED_CHECK_INTERVAL_MS, () => {
            const now = Date.now();
            this.runtime.detectSpeedHack(now - lastSpeedCheckAt);
            lastSpeedCheckAt = now;
        });
        this.scheduler.setTimeoutTask('send_status', DEFAULT_STATUS_DELAY_MS, () => {
            this.runtime.sendStatus();
        });
        this.scheduler.setTimeoutTask('function_check', DEFAULT_FUNCTION_CHECK_DELAY_MS, () => {
            this.runtime.checkFunctionArray([
                this.runtime.processReceivedData,
                this.runtime.heartbeatTick,
                this.runtime.getDataToServer,
                this.runtime.sendDataFromServer,
            ], 0);
        });
        this.schedulePoll(DEFAULT_POLL_INTERVAL_MS);
    }

    schedulePoll(delay = DEFAULT_POLL_INTERVAL_MS) {
        if (!this.running) return;
        this.scheduler.setTimeoutTask('ace_poll', delay, () => this.poll());
    }

    async poll() {
        if (!this.running) return;
        if (this.inFlight || !this.isConnected()) {
            this.schedulePoll();
            return;
        }

        let data;
        try {
            data = this.runtime.getDataToServer();
        } catch (error) {
            this.lastError = error.message;
            this.logger('warn', `ACE 获取上报数据失败：${error.message}`);
            this.schedulePoll(Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(5, ++this.failures))));
            return;
        }
        if (!data.length) {
            this.schedulePoll();
            return;
        }

        this.inFlight = true;
        try {
            const request = this.types.AntiDataRequest.encode(
                this.types.AntiDataRequest.create({ data }),
            ).finish();
            const { body } = await this.sendRequest(
                'gamepb.acepb.AceService',
                'AntiData',
                request,
                10000,
            );
            const reply = this.types.AntiDataReply.decode(body);
            const serverData = Buffer.from(reply.data || []);
            if (serverData.length) this.runtime.sendDataFromServer(serverData);
            this.failures = 0;
            this.uploadCount += 1;
            this.lastUploadAt = Date.now();
            this.schedulePoll(DEFAULT_POLL_INTERVAL_MS);
        } catch (error) {
            this.failures += 1;
            this.lastError = error.message;
            const delay = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(5, this.failures)));
            this.logger('warn', `ACE 上报失败：${error.message}，${delay}ms 后重试`);
            this.schedulePoll(delay);
        } finally {
            this.inFlight = false;
        }
    }

    stop(reason = '停止') {
        if (!this.running) return;
        this.running = false;
        this.inFlight = false;
        this.scheduler.clearAll();
        this.logger('info', `ACE ${reason}`);
    }

    getStatus() {
        return {
            running: this.running,
            inFlight: this.inFlight,
            failures: this.failures,
            uploadCount: this.uploadCount,
            lastUploadAt: this.lastUploadAt,
            lastError: this.lastError,
            runtime: this.runtime.getStatus(),
        };
    }
}

module.exports = { AceService };
