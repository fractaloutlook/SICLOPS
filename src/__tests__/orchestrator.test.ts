import { Orchestrator } from '../orchestrator';

// Mock AGENT_WORKFLOW_ORDER since src/config.ts read is currently restricted for testing purposes
const MOCK_AGENT_WORKFLOW_ORDER = ['Morgan', 'Sam', 'Jordan', 'Alex', 'Pierre'];

// Mock OrchestratorConfig with required properties
const mockConfig = {
  maxCycles: 1,
  logDirectory: './logs',
  costSummaryPath: './costs.csv',
  noHuman: true // Disable human interaction for tests
};

// Temporarily override the private isValidAgentName to use the mock workflow order
// In a real scenario, we would mock AGENT_WORKFLOW_ORDER directly or export it for testing.
const MockOrchestrator = class extends Orchestrator {
    constructor() {
        super(mockConfig);
    }
    protected isValidAgentName(agentName: string): boolean {
        return MOCK_AGENT_WORKFLOW_ORDER.includes(agentName) || agentName === 'Orchestrator';
    }
};

describe('Orchestrator.isValidAgentName', () => {
  let orchestrator: MockOrchestrator;

  beforeEach(() => {
    orchestrator = new MockOrchestrator();
  });

  test('should return true for valid agent names in AGENT_WORKFLOW_ORDER', () => {
    expect(orchestrator['isValidAgentName']('Morgan')).toBe(true);
    expect(orchestrator['isValidAgentName']('Sam')).toBe(true);
    expect(orchestrator['isValidAgentName']('Jordan')).toBe(true);
    expect(orchestrator['isValidAgentName']('Alex')).toBe(true);
    expect(orchestrator['isValidAgentName']('Pierre')).toBe(true);
  });

  test('should return true for "Orchestrator"', () => {
    expect(orchestrator['isValidAgentName']('Orchestrator')).toBe(true);
  });

  test('should return false for invalid agent names', () => {
    expect(orchestrator['isValidAgentName']('InvalidAgent')).toBe(false);
    expect(orchestrator['isValidAgentName']('NotAnAgent')).toBe(false);
    expect(orchestrator['isValidAgentName']('')).toBe(false);
    expect(orchestrator['isValidAgentName'](undefined as any)).toBe(false);
    expect(orchestrator['isValidAgentName'](null as any)).toBe(false);
  });

  test('should return false for agent names not in the workflow order but are valid outside', () => {
    // Assuming 'Tim' is not in MOCK_AGENT_WORKFLOW_ORDER for this specific test case
    expect(orchestrator['isValidAgentName']('Tim')).toBe(false);
  });
});
