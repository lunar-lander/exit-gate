import {
    AppBar,
    Box,
    Container,
    createTheme,
    CssBaseline,
    Tab,
    Tabs,
    ThemeProvider,
    Toolbar,
    Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';

import ConnectionHistory from './components/ConnectionHistory';
import ConnectionPrompt from './components/ConnectionPrompt';
import Dashboard from './components/Dashboard';
import RulesManager from './components/RulesManager';
import { ConnectionPrompt as ConnectionPromptType, HistoryEntry, Rule, Stats } from './types';

// Modern Pastel & Dark Theme
const theme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: '#0f172a', // Slate 900
            paper: '#1e293b',   // Slate 800
        },
        primary: {
            main: '#818cf8', // Indigo 400
        },
        secondary: {
            main: '#c084fc', // Purple 400
        },
        success: {
            main: '#34d399', // Emerald 400
        },
        error: {
            main: '#f87171', // Red 400
        },
        text: {
            primary: '#f8fafc', // Slate 50
            secondary: '#94a3b8', // Slate 400
        },
    },
    typography: {
        fontFamily: [
            'Inter',
            '-apple-system',
            'BlinkMacSystemFont',
            '"Segoe UI"',
            'Roboto',
            '"Helvetica Neue"',
            'Arial',
            'sans-serif',
        ].join(','),
        h4: {
            fontWeight: 600,
            letterSpacing: '-0.02em',
        },
        h6: {
            fontWeight: 600,
            letterSpacing: '-0.01em',
        },
    },
    shape: {
        borderRadius: 16,
    },
    components: {
        MuiAppBar: {
            styleOverrides: {
                root: {
                    backgroundColor: '#1e293b',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    backgroundImage: 'none',
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    backgroundColor: '#1e293b',
                    border: '1px solid rgba(255,255,255,0.05)',
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },
        MuiTab: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                },
            },
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
        window.electron.getStats();

        // Listen for daemon messages; capture the returned cleanup function
        const removeDaemonListener = window.electron.onDaemonMessage((message) => {
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
                    setConnectionPrompts((prev) => [...prev, message as unknown as ConnectionPromptType]);
                    break;

                case 'ConnectionEvent':
                    // Prepend to history, cap at 50 000 entries
                    setHistory((prev) => [message as unknown as HistoryEntry, ...prev].slice(0, 50000));
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

        // Remove the IPC listener when the component unmounts
        return () => {
            removeDaemonListener();
        };
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
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
                <AppBar position="static" elevation={0}>
                    <Toolbar>
                        <Box component="img" src="logo.png" sx={{ width: 40, height: 40, mr: 2 }} />
                        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                            Exit Gate
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

                <Container maxWidth="xl" sx={{ mt: { xs: 2, md: 4 }, mb: 4, flexGrow: 1, overflow: 'auto', px: { xs: 2, md: 4 } }}>
                    {currentTab === 0 && <Dashboard stats={stats} recentConnections={history} />}
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
