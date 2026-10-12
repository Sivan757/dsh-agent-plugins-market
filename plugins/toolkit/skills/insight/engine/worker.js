import { parentPort, workerData } from 'node:worker_threads'
import { buildReport } from './analyzer.js'
parentPort.postMessage(buildReport(workerData.snapshots, workerData.options))
