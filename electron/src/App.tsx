import React, { useState, useEffect } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Box,
  AppBar,
  Toolbar,
  Typography,
  Tabs,
  Tab,
  Container,
  Paper,
} from '@mui/material';
import { Shield } from '@mui/icons-material';
import Dashboard from './components/Dashboard';
import RulesManager from './components/RulesManager';
import ConnectionHistory from './components/ConnectionHistory';
import ConnectionPrompt from './components/ConnectionPrompt';
import { Rule, ConnectionPrompt as ConnectionPromptType, HistoryEntry, Stats } from './types';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00e676',
    },
    secondary: {
      main: '#ff1744',
    },
  },
});

function App() {
  const [currentTab, setCurrentTab] = useState(0);
  const [rules, setRules] = useState<Rule[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<Stats>({
    total_connections: 0,
    allowed: 0,
    denied: 0,
    active_rules: 0,
  });
  const [connectionPrompts, setConnectionPrompts] = useState<ConnectionPromptType[]>([]);

  useEffect(() => {
    // Request initial data
    window.electron.getRules();
    window.electron.getHistory(100);
    window.electron.getStats();

    // Listen for daemon messages
    window.electron.onDaemonMessage((message) => {
      console.log('Daemon message:', message);

      switch (message.type) {
        case 'RulesList':
          setRules(message.rules || []);
          break;

        case 'HistoryData':
          setHistory(message.entries || []);
          break;

        case 'StatsData':
          setStats(message.stats);
          break;

        case 'ConnectionPrompt':
          setConnectionPrompts((prev) => [...prev, message as ConnectionPromptType]);
          break;

        case 'ConnectionEvent':
          // Add to history
          setHistory((prev) => [message, ...prev].slice(0, 100));
          break;

        case 'Success':
          console.log('Success:', message.message);
          // Refresh rules after successful operation
          window.electron.getRules();
          break;

        case 'Error':
          console.error('Error:', message.message);
          break;
      }
    });
  }, []);

  const handlePromptResponse = (
    promptId: string,
    action: 'allow' | 'deny',
    remember: boolean,
    duration: string
  ) => {
    window.electron.respondToPrompt(promptId, action, remember, duration);
    setConnectionPrompts((prev) => prev.filter((p) => p.prompt_id !== promptId));
  };

  const handleAddRule = (rule: Rule) => {
    window.electron.addRule(rule);
  };

  const handleUpdateRule = (rule: Rule) => {
    window.electron.updateRule(rule);
  };

  const handleDeleteRule = (ruleId: number) => {
    window.electron.deleteRule(ruleId);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <AppBar position="static" elevation={0}>
          <Toolbar>
            <Shield sx={{ mr: 2 }} />
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Exit Gate - Linux Application Firewall
            </Typography>
          </Toolbar>
          <Tabs
            value={currentTab}
            onChange={(_, newValue) => setCurrentTab(newValue)}
            textColor="primary"
            indicatorColor="primary"
          >
            <Tab label="Dashboard" />
            <Tab label="Rules" />
            <Tab label="History" />
          </Tabs>
        </AppBar>

        <Container maxWidth={false} sx={{ mt: 3, mb: 3, flexGrow: 1, overflow: 'auto' }}>
          {currentTab === 0 && <Dashboard stats={stats} recentConnections={history.slice(0, 10)} />}
          {currentTab === 1 && (
            <RulesManager
              rules={rules}
              onAddRule={handleAddRule}
              onUpdateRule={handleUpdateRule}
              onDeleteRule={handleDeleteRule}
            />
          )}
          {currentTab === 2 && <ConnectionHistory history={history} />}
        </Container>

        {/* Connection Prompts */}
        {connectionPrompts.map((prompt) => (
          <ConnectionPrompt
            key={prompt.prompt_id}
            prompt={prompt}
            onResponse={handlePromptResponse}
          />
        ))}
      </Box>
    </ThemeProvider>
  );
}

export default App;
