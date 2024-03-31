import { Test, TestingModule } from '@nestjs/testing';
import { SetupService } from './setup.service';

describe('SetupService', () => {
  let service: SetupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SetupService],
    }).compile();

    service = module.get<SetupService>(SetupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
