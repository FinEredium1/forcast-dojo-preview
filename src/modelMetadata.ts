export type ModelMetadata = {
  officialName: string
  chartName: string
  parameters: string
  architecture: string
  reasoningEffort: string
  proprietary?: boolean
  sources: string[]
}

// Benchmark reasoning settings: Forecast Dojo v1, Table 10 (including its native-reasoning footnote).
export const MODEL_REASONING_SOURCE = 'https://arxiv.org/pdf/2609.28876v1#page=19'

const undisclosed = { parameters: 'Not publicly disclosed', architecture: 'Not publicly disclosed', proprietary: true }

const models: Record<string, ModelMetadata> = {
  'GPT-5.6 Sol': {
    officialName: 'GPT-5.6 Sol', chartName: 'GPT-5.6 Sol', ...undisclosed, reasoningEffort: 'max',
    sources: ['https://developers.openai.com/api/docs/models/gpt-5.6-sol'],
  },
  'GPT-5.5': {
    officialName: 'GPT-5.5', chartName: 'GPT-5.5', ...undisclosed, reasoningEffort: 'xhigh',
    sources: ['https://developers.openai.com/api/docs/models/gpt-5.5'],
  },
  'GPT-5.4': {
    officialName: 'GPT-5.4', chartName: 'GPT-5.4', ...undisclosed, reasoningEffort: 'xhigh',
    sources: ['https://developers.openai.com/api/docs/models/gpt-5.4'],
  },
  'Opus 4.8 max': {
    officialName: 'Claude Opus 4.8', chartName: 'Opus 4.8', ...undisclosed, reasoningEffort: 'max',
    sources: ['https://www.anthropic.com/news/claude-opus-4-8'],
  },
  'Opus 4.6': {
    officialName: 'Claude Opus 4.6', chartName: 'Opus 4.6', ...undisclosed, reasoningEffort: 'max',
    sources: ['https://www.anthropic.com/news/claude-opus-4-6'],
  },
  'GLM-5': {
    officialName: 'GLM-5', chartName: 'GLM-5', parameters: '744B total · 40B active', architecture: 'Mixture of experts (MoE)', reasoningEffort: 'high',
    sources: ['https://huggingface.co/zai-org/GLM-5', 'https://huggingface.co/zai-org/GLM-5/blob/main/config.json'],
  },
  'Kimi K2.5': {
    officialName: 'Kimi K2.5', chartName: 'Kimi K2.5', parameters: '1T total · 32B active', architecture: 'Mixture of experts (MoE)', reasoningEffort: 'high',
    sources: ['https://github.com/MoonshotAI/Kimi-K2.5'],
  },
  'Qwen3.5 397B': {
    officialName: 'Qwen3.5-397B-A17B', chartName: 'Qwen3.5', parameters: '397B total · 17B active', architecture: 'Hybrid mixture of experts (MoE)', reasoningEffort: 'Native (no effort parameter)',
    sources: ['https://huggingface.co/Qwen/Qwen3.5-397B-A17B'],
  },
  'DeepSeek V3.2': {
    officialName: 'DeepSeek-V3.2', chartName: 'DeepSeek V3.2', parameters: '671B total · 37B active', architecture: 'Mixture of experts (MoE)', reasoningEffort: 'high',
    // Main-model counts exclude the auxiliary multi-token prediction module.
    sources: ['https://huggingface.co/deepseek-ai/DeepSeek-V3.2', 'https://github.com/deepseek-ai/DeepSeek-V3.2-Exp', 'https://github.com/deepseek-ai/DeepSeek-V3'],
  },
  'MiniMax M2.5': {
    officialName: 'MiniMax-M2.5', chartName: 'MiniMax M2.5', parameters: '230B total · 10B active', architecture: 'Mixture of experts (MoE)', reasoningEffort: 'Native (no effort parameter)',
    sources: ['https://huggingface.co/MiniMaxAI/MiniMax-M2.5', 'https://aws.amazon.com/blogs/machine-learning/run-minimax-models-on-amazon-bedrock/'],
  },
  'Nemotron 3 Super': {
    officialName: 'NVIDIA Nemotron 3 Super', chartName: 'Nemotron 3 Super', parameters: '120B total · 12B active', architecture: 'Hybrid Mamba–Transformer MoE', reasoningEffort: 'high',
    sources: ['https://blogs.nvidia.com/blog/nemotron-3-super-agentic-ai/'],
  },
  'gpt-oss-120b': {
    officialName: 'gpt-oss-120b', chartName: 'gpt-oss', parameters: '116.8B total · 5.1B active', architecture: 'Mixture of experts (MoE)', reasoningEffort: 'high',
    sources: ['https://deploymentsafety.openai.com/gpt-oss'],
  },
}

export function modelMetadataFor(modelName: string): ModelMetadata {
  return models[modelName] ?? {
    officialName: modelName, chartName: modelName, parameters: 'Not available', architecture: 'Not available', reasoningEffort: 'Not recorded', sources: [],
  }
}
