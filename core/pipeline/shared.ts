export interface PipelineStage {
  outputTexture: GPUTexture
  encode: (encoder: GPUCommandEncoder, targetView?: GPUTextureView) => void
}

export interface WhenSize {
  w: number
  h: number
}

export interface WhenContext {
  OUTPUT: WhenSize
  MAIN: WhenSize
  NATIVE: WhenSize
}

export interface WhenReferenceDimensions {
  output: WhenSize
  native: WhenSize
}

export const vertexShader = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
}

@vertex
fn v(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let pos = array(
    vec2f(-1, 1),
    vec2f(4, 1),
    vec2f(-1, -4),
  );
  var out: VSOut;
  out.pos = vec4f(pos[vertexIndex], 0, 1);
  return out;
}
`

export function createTexture(
  device: GPUDevice,
  width: number,
  height: number,
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    format: 'rgba8unorm',
    size: [width, height],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
}

export function setupPlaceholderStage(
  inputTexture: GPUTexture,
  stageName: string,
): PipelineStage {
  return {
    outputTexture: inputTexture,
    encode() {
      console.warn(
        `${stageName} is a placeholder stage and is currently bypassed.`,
      )
    },
  }
}

export function buildWhenContext(
  main: WhenSize,
  reference: WhenReferenceDimensions,
): WhenContext {
  return {
    OUTPUT: reference.output,
    MAIN: main,
    NATIVE: reference.native,
  }
}

export function parseWhenExpression(expression: string): string[] {
  return expression
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

function resolveWhenTokenValue(token: string, context: WhenContext): number | null {
  const [scope, axis] = token.split('.')
  if (!scope || !axis) {
    return null
  }

  if (
    (scope === 'OUTPUT' || scope === 'MAIN' || scope === 'NATIVE') &&
    (axis === 'w' || axis === 'h')
  ) {
    return context[scope][axis]
  }

  return null
}

function popBinaryOperands(stack: number[], token: string): [number, number] {
  if (stack.length < 2) {
    throw new Error(`Invalid !WHEN expression near token: ${token}`)
  }

  const rhs = stack.pop()
  const lhs = stack.pop()
  if (rhs === undefined || lhs === undefined) {
    throw new Error(`Invalid !WHEN expression near token: ${token}`)
  }

  return [lhs, rhs]
}

function popUnaryOperand(stack: number[], token: string): number {
  if (stack.length < 1) {
    throw new Error(`Invalid !WHEN expression near token: ${token}`)
  }

  const value = stack.pop()
  if (value === undefined) {
    throw new Error(`Invalid !WHEN expression near token: ${token}`)
  }

  return value
}

export function evaluateWhenExpression(
  expression: string | null | undefined,
  context: WhenContext,
): boolean {
  if (!expression?.trim()) {
    return true
  }

  const tokens = parseWhenExpression(expression)
  const stack: number[] = []

  for (const token of tokens) {
    const literal = Number(token)
    if (Number.isFinite(literal)) {
      stack.push(literal)
      continue
    }

    const resolved = resolveWhenTokenValue(token, context)
    if (resolved !== null) {
      stack.push(resolved)
      continue
    }

    if (token === '!') {
      const value = popUnaryOperand(stack, token)
      stack.push(value === 0 ? 1 : 0)
      continue
    }

    const [lhs, rhs] = popBinaryOperands(stack, token)

    switch (token) {
      case '+':
        stack.push(lhs + rhs)
        break
      case '-':
        stack.push(lhs - rhs)
        break
      case '*':
        stack.push(lhs * rhs)
        break
      case '/':
        if (rhs === 0) {
          throw new Error('Invalid !WHEN expression: division by zero')
        }
        stack.push(lhs / rhs)
        break
      case '%':
        if (rhs === 0) {
          throw new Error('Invalid !WHEN expression: modulo by zero')
        }
        stack.push(lhs % rhs)
        break
      case '<':
        stack.push(lhs < rhs ? 1 : 0)
        break
      case '>':
        stack.push(lhs > rhs ? 1 : 0)
        break
      case '<=':
        stack.push(lhs <= rhs ? 1 : 0)
        break
      case '>=':
        stack.push(lhs >= rhs ? 1 : 0)
        break
      case '==':
      case '=':
        stack.push(lhs === rhs ? 1 : 0)
        break
      case '!=':
        stack.push(lhs !== rhs ? 1 : 0)
        break
      default:
        throw new Error(`Unsupported !WHEN token: ${token}`)
    }
  }

  if (stack.length !== 1) {
    throw new Error('Invalid !WHEN expression: unresolved stack state')
  }

  return stack[0] !== 0
}
