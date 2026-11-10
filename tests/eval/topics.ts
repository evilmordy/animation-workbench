/** 五题题面。与 DESIGN.md §11.1 逐字相同。 */

export const TOPICS = [
  {
    id: 'zugeng',
    intent: '祖暅原理：用祖暅原理推导球体积（半球与圆柱挖去圆锥，任意高度截面积相等）',
  },
  {
    id: 'linalg',
    intent: '线性代数：矩阵作为线性变换（基向量变换、行列式是面积缩放）',
  },
  {
    id: 'mergesort',
    intent: '归并排序：分治与合并过程，含复杂度 O(n log n)',
  },
  {
    id: 'transform',
    intent:
      'Transform 的数学原理与实现动画：一个图形如何通过逐点线性插值 P(t)=(1-t)·A+t·B 变成另一个图形（点对齐/重采样、插值、缓动函数 rate(t)），并展示关键参数 t 处的中间帧与公式一致',
  },
  {
    id: 'psych',
    intent: '心理学小知识：蔡格尼克效应——讲清现象（未完成的任务比已完成的更容易被记住）、经典实验与解释',
  },
] as const;

export type TopicId = (typeof TOPICS)[number]['id'];
export type Topic = (typeof TOPICS)[number];

export const EVAL_MODEL = 'deepseek-chat';
export const EVAL_TEMPERATURE = 0.3;
