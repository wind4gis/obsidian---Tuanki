/**
 * DeepSeek AI服务实现
 * 继承自OpenAIService，使用DeepSeek API端点
 */

import { requestUrl } from 'obsidian';
import {
  GenerationConfig,
  GenerationProgress,
  AIServiceResponse,
  GeneratedCard
} from '../../types/ai-types';
import { OpenAIService } from './OpenAIService';

export class DeepSeekService extends OpenAIService {
  /**
   * DeepSeek API基础URL
   */
  protected baseUrl = 'https://api.deepseek.com';

  async generateCards(
    content: string,
    config: GenerationConfig,
    onProgress?: (progress: GenerationProgress) => void
  ): Promise<AIServiceResponse> {
    let progressInterval: NodeJS.Timeout | undefined;

    try {
      // 优化的进度更新策略：非线性增长,减少等待焦虑
      onProgress?.({
        status: 'preparing',
        progress: 15,
        message: '准备生成卡片...'
      });

      const systemPrompt = this.buildSystemPrompt(config);
      const userPrompt = this.buildUserPrompt(content, config.promptTemplate);

      onProgress?.({
        status: 'generating',
        progress: 25,
        message: '正在调用AI服务...'
      });

      // 模拟进度增长（等待API响应期间）
      progressInterval = setInterval(() => {
        if (onProgress) {
          const currentProgress = Math.min(85, 25 + Math.random() * 5);
          onProgress({
            status: 'generating',
            progress: currentProgress,
            message: `AI正在思考...（${config.cardCount}张卡片）`
          });
        }
      }, 500);

      const response = await requestUrl({
        url: `${this.baseUrl}/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: config.temperature,
          max_tokens: config.maxTokens
        })
      });

      clearInterval(progressInterval);

      onProgress?.({
        status: 'parsing',
        progress: 90,
        message: '解析生成结果...'
      });

      const data = response.json;
      const content_text = data.choices[0].message.content;
      const parsedCards = this.parseResponse(content_text);

      // 转换为GeneratedCard格式
      const cards: GeneratedCard[] = parsedCards.map((card: any) => ({
        id: this.generateCardId(),
        type: card.type || 'qa',
        front: this.ensureString(card.front),
        back: this.ensureString(card.back),
        choices: card.choices,
        correctAnswer: card.correctAnswer,
        clozeText: card.clozeText,
        tags: card.tags || [],
        images: card.images || [],
        explanation: card.explanation,
        metadata: {
          generatedAt: new Date().toISOString(),
          provider: 'deepseek',
          model: this.model,
          temperature: config.temperature
        }
      }));

      onProgress?.({
        status: 'completed',
        progress: 100,
        message: `成功生成${cards.length}张卡片`
      });

      return {
        success: true,
        cards,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          estimatedCost: this.estimateCost(
            data.usage.prompt_tokens,
            data.usage.completion_tokens
          )
        }
      };
    } catch (error) {
      progressInterval && clearInterval(progressInterval);
      onProgress?.({
        status: 'failed',
        progress: 0,
        message: '生成失败'
      });
      return this.handleError(error);
    }
  }

  /**
   * DeepSeek成本估算
   * 参考：https://platform.deepseek.com/pricing
   */
  estimateCost(promptTokens: number, completionTokens: number): number {
    // DeepSeek-Chat 定价（2024年价格，单位：元/百万tokens）
    const PROMPT_PRICE = 1.0;      // ¥1/M tokens (输入)
    const COMPLETION_PRICE = 2.0;  // ¥2/M tokens (输出)

    const promptCost = (promptTokens / 1_000_000) * PROMPT_PRICE;
    const completionCost = (completionTokens / 1_000_000) * COMPLETION_PRICE;

    return promptCost + completionCost;
  }

  /**
   * 测试DeepSeek API连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const { requestUrl } = await import('obsidian');

      const response = await requestUrl({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      });

      return response.status === 200;
    } catch (error) {
      console.error('DeepSeek connection test failed:', error);
      return false;
    }
  }

  /**
   * DeepSeek特定错误处理
   */
  protected handleError(error: any): any {
    console.error('DeepSeek API Error:', error);

    let errorMessage = 'DeepSeek API调用失败';

    if (error.message) {
      if (
        error.message.includes('401') ||
        error.message.includes('Unauthorized')
      ) {
        errorMessage = 'DeepSeek API密钥无效，请检查配置';
      } else if (
        error.message.includes('429') ||
        error.message.includes('rate limit')
      ) {
        errorMessage = 'DeepSeek API请求频率超限，请稍后重试';
      } else if (error.message.includes('quota')) {
        errorMessage = 'DeepSeek API配额不足';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'DeepSeek API请求超时';
      } else {
        errorMessage = `DeepSeek API错误: ${error.message}`;
      }
    }

    return {
      success: false,
      error: errorMessage,
      cards: []
    };
  }
}
