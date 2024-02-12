import axios from 'axios';
import { z } from 'zod';
import { checkIntegrationsType } from '~/tools/client/app-properties';
import { getConfig } from '~/tools/config/getConfig';
import { createTRPCRouter, publicProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';
import { ConfigAppType } from '~/types/app';

const inputSchema = z.object({
  appId: z.string(),
  configName: z.string(),
});

const inputSchemeQueue = inputSchema.extend({
  showHealthChecksInQueue: z.boolean(),
  pageSize: z.number(),
  page: z.number(),
});

const getStatisticsSchema = z.object({
  totalFileCount: z.number(),
  totalTranscodeCount: z.number(),
  totalHealthCheckCount: z.number(),
  table3Count: z.number(),
  table6Count: z.number(),
  table1Count: z.number(),
  table4Count: z.number(),
  pies: z.array(z.tuple([
    z.string(), // Library Name
    z.string(), // Library ID
    z.number(), // File count
    z.number(), // Number of transcodes
    z.number(), // Space saved (in GB)
    z.number(), // Number of health checks
    z.array(z.object({ // Transcode Status (Pie segments)
      name: z.string(),
      value: z.number(),
    })),
    z.array(z.object({ // Health Status (Pie segments)
      name: z.string(),
      value: z.number(),
    })),
    z.array(z.object({ // Video files - Codecs (Pie segments)
      name: z.string(),
      value: z.number(),
    })),
    z.array(z.object({ // Video files - Containers (Pie segments)
      name: z.string(),
      value: z.number(),
    })),
    z.array(z.object({ // Video files - Resolutions (Pie segments)
      name: z.string(),
      value: z.number(),
    })),
    z.array(z.object({ // Audio files - Codecs (Pie segments)
      name: z.string(),
      value: z.number(),
    })),
    z.array(z.object({ // Audio files - Containers (Pie segments)
      name: z.string(),
      value: z.number(),
    })),
  ])),
});

type PieSegment = {
  name: string;
  value: number;
}

export type TdarrStatistics = {
  totalFileCount: number;
  totalTranscodeCount: number;
  totalHealthCheckCount: number;
  failedTranscodeCount: number;
  failedHealthCheckCount: number;
  stagedTranscodeCount: number;
  stagedHealthCheckCount: number;
  pies: {
    libraryName: string;
    libraryId: string;
    totalFiles: number;
    totalTranscodes: number;
    savedSpace: number;
    totalHealthChecks: number;
    transcodeStatus: PieSegment[];
    healthCheckStatus: PieSegment[];
    videoCodecs: PieSegment[];
    videoContainers: PieSegment[];
    videoResolutions: PieSegment[];
    audioCodecs: PieSegment[];
    audioContainers: PieSegment[];
  }[];
}

const getNodesResponseSchema = z.record(z.string(), z.object({
  _id: z.string(),
  nodeName: z.string(),
  nodePaused: z.boolean(),
  workers: z.record(z.string(), z.object({
    _id: z.string(),
    file: z.string(),
    fps: z.number(),
    percentage: z.number(),
    ETA: z.string(),
    job: z.object({
      type: z.string(),
    }),
    status: z.string(),
    lastPluginDetails: z.object({
      number: z.string(),
    }).optional(),
    originalfileSizeInGbytes: z.number(),
    estSize: z.number(),
    outputFileSizeInGbytes: z.number(),
  })),
}));

export type TdarrWorker = {
  id: string;
  file: string;
  fps: number;
  percentage: number;
  ETA: string;
  jobType: string;
  status: string;
  step: string;
  originalSize: number;
  estimatedSize: number;
  outputSize: number;
}

const getStatusTableSchema = z.object({
  array: z.array(z.object({
    _id: z.string(),
    HealthCheck: z.string(),
    TranscodeDecisionMaker: z.string(),
    file: z.string(),
    file_size: z.number(),
    container: z.string(),
    video_codec_name: z.string(),
    video_resolution: z.string(),
  })),
  totalCount: z.number(),
});

export type Queue = {
  array: {
    id: string;
    healthCheck: string;
    transcode: string;
    file: string;
    fileSize: number;
    container: string;
    codec: string;
    resolution: string;
    type: 'transcode' | 'health check';
  }[],
  totalCount: number;
  startIndex: number;
  endIndex: number;
}

export const tdarrRouter = createTRPCRouter({
  statistics: publicProcedure
    .input(inputSchema)
    .query(async ({ input }): Promise<TdarrStatistics> => {
      const app = getTdarrApp(input.appId, input.configName);
      const appUrl = new URL('api/v2/cruddb', app.url);

      const body = {
        data: {
          collection: 'StatisticsJSONDB',
          mode: 'getById',
          docID: 'statistics',
        },
      };

      const res = await axios.post(appUrl.toString(), body);
      const data = getStatisticsSchema.parse(res.data);

      return {
        totalFileCount: data.totalFileCount,
        totalTranscodeCount: data.totalTranscodeCount,
        totalHealthCheckCount: data.totalHealthCheckCount,
        failedTranscodeCount: data.table3Count,
        failedHealthCheckCount: data.table6Count,
        stagedTranscodeCount: data.table1Count,
        stagedHealthCheckCount: data.table4Count,
        pies: data.pies.map(pie => ({
          libraryName: pie[0],
          libraryId: pie[1],
          totalFiles: pie[2],
          totalTranscodes: pie[3],
          savedSpace: pie[4] * 1_000_000, // file_size is in MB, convert to bytes,
          totalHealthChecks: pie[5],
          transcodeStatus: pie[6],
          healthCheckStatus: pie[7],
          videoCodecs: pie[8],
          videoContainers: pie[9],
          videoResolutions: pie[10],
          audioCodecs: pie[11],
          audioContainers: pie[12],
        })),
      };
    }),

  workers: publicProcedure
    .input(inputSchema)
    .query(async ({ input }): Promise<TdarrWorker[]> => {
      const app = getTdarrApp(input.appId, input.configName);
      const appUrl = new URL('api/v2/get-nodes', app.url);

      const res = await axios.get(appUrl.toString());
      const data = getNodesResponseSchema.parse(res.data);

      const nodes = Object.values(data);
      const workers = nodes.flatMap(node => {
        return Object.values(node.workers);
      });

      return workers.map(worker => ({
        id: worker._id,
        file: worker.file,
        fps: worker.fps,
        percentage: worker.percentage,
        ETA: worker.ETA,
        jobType: worker.job.type,
        status: worker.status,
        step: worker.lastPluginDetails?.number ?? '',
        originalSize: worker.originalfileSizeInGbytes * 1_000_000, // file_size is in MB, convert to bytes,
        estimatedSize: worker.estSize * 1_000_000, // file_size is in MB, convert to bytes,
        outputSize: worker.outputFileSizeInGbytes * 1_000_000, // file_size is in MB, convert to bytes,
      }));
    }),

  queue: publicProcedure
    .input(inputSchemeQueue)
    .query(async ({ input }): Promise<Queue> => {
      const app = getTdarrApp(input.appId, input.configName);

      const appUrl = new URL('api/v2/client/status-tables', app.url);

      const { page, pageSize, showHealthChecksInQueue } = input;

      const firstItemIndex = page * pageSize;

      const transcodeQueueBody = {
        data: {
          start: firstItemIndex,
          pageSize: pageSize,
          filters: [],
          sorts: [],
          opts: {
            table: 'table1',
          },
        },
      };

      const transcodeQueueRes = await axios.post(appUrl.toString(), transcodeQueueBody);
      const transcodeQueueData = getStatusTableSchema.parse(transcodeQueueRes.data);

      const transcodeQueueResult = {
        array: transcodeQueueData.array.map(item => ({
          id: item._id,
          healthCheck: item.HealthCheck,
          transcode: item.TranscodeDecisionMaker,
          file: item.file,
          fileSize: item.file_size * 1_000_000, // file_size is in MB, convert to bytes
          container: item.container,
          codec: item.video_codec_name,
          resolution: item.video_resolution,
          type: 'transcode' as const,
        })),
        totalCount: transcodeQueueData.totalCount,
        startIndex: firstItemIndex,
        endIndex: firstItemIndex + transcodeQueueData.array.length - 1
      };

      if (!showHealthChecksInQueue) {
        return transcodeQueueResult;
      }

      const healthCheckQueueBody = {
        data: {
          start: Math.max(firstItemIndex - transcodeQueueData.totalCount, 0),
          pageSize: pageSize,
          filters: [],
          sorts: [],
          opts: {
            table: 'table4',
          },
        },
      };

      const healthCheckQueueRes = await axios.post(appUrl.toString(), healthCheckQueueBody);
      const healthCheckQueueData = getStatusTableSchema.parse(healthCheckQueueRes.data);

      const healthCheckResultArray = healthCheckQueueData.array.map(item => ({
        id: item._id,
        healthCheck: item.HealthCheck,
        transcode: item.TranscodeDecisionMaker,
        file: item.file,
        fileSize: item.file_size * 1_000_000, // file_size is in MB, convert to bytes
        container: item.container,
        codec: item.video_codec_name,
        resolution: item.video_resolution,
        type: 'health check' as const,
      }))

      const combinedArray = [...transcodeQueueResult.array, ...healthCheckResultArray].slice(0, pageSize);

      return {
        array: combinedArray,
        totalCount: transcodeQueueData.totalCount + healthCheckQueueData.totalCount,
        startIndex: firstItemIndex,
        endIndex: firstItemIndex + combinedArray.length - 1
      };
    }),
});

function getTdarrApp(appId: string, configName: string): ConfigAppType {
  const config = getConfig(configName);

  const app = config.apps.find((x) => x.id === appId);

  if (!app) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `[Tdarr integration] App with ID "${appId}" could not be found.`,
    });
  }

  if (!checkIntegrationsType(app.integration, ['tdarr'])) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `[Tdarr integration] App with ID "${appId}" is not using the Tdarr integration.`,
    });
  }

  return app;
}
