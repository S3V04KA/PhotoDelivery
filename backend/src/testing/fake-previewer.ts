import { PreviewError, type PreviewRequest, type PreviewResult, type Previewer } from '../services/preview';
import { videoThumbKey } from '../services/preview';

export class FakePreviewer implements Previewer {
  readonly calls: PreviewRequest[] = [];
  readonly failingNames = new Set<string>();

  constructor(private readonly body: string = 'fake-thumb') {}

  async generate(request: PreviewRequest): Promise<PreviewResult> {
    this.calls.push(request);
    if (this.failingNames.has(request.fileName)) {
      throw new PreviewError('превью недоступно');
    }
    return { key: videoThumbKey(request.setId, request.fileName), body: Buffer.from(this.body) };
  }
}
