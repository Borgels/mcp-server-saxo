import { describe, expect, it } from 'vitest';
import {
  adjustedProfitTakePercent,
  buildStrategyRiskAnalytics,
  playbookRiskDefaults,
} from '../src/saxo/strategy-risk-analytics.js';

describe('strategy risk analytics', () => {
  it('computes expected move, vol-scaled levels, and touch probabilities', () => {
    const result = buildStrategyRiskAnalytics({
      annualizedVolatilityPercent: 100,
      averageRange14dPercent: 5,
      dte: 91.25,
      maxLoss: 200,
      maxProfit: 300,
      playbook: 'aggressive_short_term',
      spot: 100,
    });

    expect(result.expectedMove1Sigma).toBe(50);
    expect(result.expectedMove2Sigma).toBe(100);
    expect(result.atr14Estimate).toBe(5);
    expect(result.suggestedStopSpot).toBe(75);
    expect(result.suggestedProfitTakeSpot).toBe(150);
    expect(result.expectedTouchProbabilityToStop).toBeCloseTo(61.71, 1);
    expect(result.expectedTouchProbabilityToTarget).toBeCloseTo(31.73, 1);
    expect(result.modelExpectedValue).toMatchObject({
      profitAtTarget: 225,
      lossAtStop: -100,
      estimatedValue: expect.any(Number),
      estimatedValuePercentOfMaxRisk: expect.any(Number),
    });
  });

  it('anchors directional debit spread stops to long strike when more conservative', () => {
    const result = buildStrategyRiskAnalytics({
      annualizedVolatilityPercent: 60,
      dte: 120,
      direction: 'bullish',
      longStrike: 95,
      playbook: 'long_term_directional',
      spot: 100,
    });

    expect(result.suggestedStopSpot).toBe(95);
    expect(result.longStrikeStopReference).toBe(95);
  });

  it('uses playbook defaults and long-dated profit-take adjustment', () => {
    expect(playbookRiskDefaults('leaps_replacement')).toMatchObject({
      profitTakePercentOfMaxProfit: 100,
      stopSigmaMultiple: 1.5,
      timeStopDte: 60,
    });
    expect(adjustedProfitTakePercent({
      baseProfitTakePercent: 65,
      currentDte: 80,
      originalDte: 100,
    })).toBe(39);
    expect(adjustedProfitTakePercent({
      baseProfitTakePercent: 65,
      currentDte: 30,
      originalDte: 100,
    })).toBe(55.25);
  });

  it('surfaces notes and omits model outputs when required inputs are missing', () => {
    const result = buildStrategyRiskAnalytics({ spot: 100, playbook: 'income_30_60d' });

    expect(result.expectedMove1Sigma).toBeUndefined();
    expect(result.expectedTouchProbabilityToTarget).toBeUndefined();
    expect(result.notes.join(' ')).toContain('DTE unavailable');
  });
});
