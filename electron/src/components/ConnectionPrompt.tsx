import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip,
  FormControlLabel,
  Checkbox,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Grid,
  Divider,
} from '@mui/material';
import {
  Block,
  CheckCircle,
  Computer,
  Language,
  ArrowForward,
} from '@mui/icons-material';
import { ConnectionPrompt as ConnectionPromptType } from '../types';

interface ConnectionPromptProps {
  prompt: ConnectionPromptType;
  onResponse: (
    promptId: string,
    action: 'allow' | 'deny',
    remember: boolean,
    duration: string
  ) => void;
}

const ConnectionPrompt: React.FC<ConnectionPromptProps> = ({ prompt, onResponse }) => {
  const [remember, setRemember] = useState(true);
  const [duration, setDuration] = useState('forever');

  const handleAllow = () => {
    onResponse(prompt.prompt_id, 'allow', remember, duration);
  };

  const handleDeny = () => {
    onResponse(prompt.prompt_id, 'deny', remember, duration);
  };

  const executableName = prompt.executable.split('/').pop() || prompt.executable;

  return (
    <Dialog
      open={true}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          borderTop: 4,
          borderColor: 'warning.main',
        },
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Computer color="primary" />
          <Typography variant="h6">Connection Request</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Grid container spacing={2}>
          {/* Application Info */}
          <Grid item xs={12}>
            <Box
              sx={{
                p: 2,
                bgcolor: 'background.default',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Computer sx={{ fontSize: 48, color: 'primary.main' }} />
              <Box flexGrow={1}>
                <Typography variant="h6" gutterBottom>
                  {executableName}
                </Typography>
                <Typography variant="body2" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                  {prompt.executable}
                </Typography>
                <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1 }}>
                  PID: {prompt.pid} | UID: {prompt.uid}
                </Typography>
              </Box>
            </Box>
          </Grid>

          {/* Connection Details */}
          <Grid item xs={12}>
            <Typography variant="subtitle2" color="textSecondary" gutterBottom>
              Wants to connect to:
            </Typography>
            <Box
              sx={{
                p: 2,
                bgcolor: 'background.default',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Language sx={{ fontSize: 40, color: 'info.main' }} />
              <Box flexGrow={1}>
                <Typography variant="h6">
                  {prompt.dest_host || prompt.dest_ip}:{prompt.dest_port}
                </Typography>
                {prompt.dest_host && (
                  <Typography variant="body2" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                    {prompt.dest_ip}
                  </Typography>
                )}
                <Box mt={1}>
                  <Chip label={prompt.protocol} size="small" color="primary" />
                </Box>
              </Box>
            </Box>
          </Grid>

          {/* Command Line */}
          {prompt.cmdline && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                Command:
              </Typography>
              <Box
                sx={{
                  p: 1.5,
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  overflowX: 'auto',
                }}
              >
                {prompt.cmdline}
              </Box>
            </Grid>
          )}

          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
          </Grid>

          {/* Remember Options */}
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  color="primary"
                />
              }
              label="Remember this decision"
            />
          </Grid>

          {remember && (
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Duration</InputLabel>
                <Select
                  value={duration}
                  label="Duration"
                  onChange={(e) => setDuration(e.target.value)}
                >
                  <MenuItem value="once">This time only</MenuItem>
                  <MenuItem value="process">While process is running</MenuItem>
                  <MenuItem value="restart">Until system restart</MenuItem>
                  <MenuItem value="forever">Forever (save as permanent rule)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          )}
        </Grid>
      </DialogContent>

      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button
          variant="contained"
          color="error"
          size="large"
          startIcon={<Block />}
          onClick={handleDeny}
          sx={{ minWidth: 120 }}
        >
          Deny
        </Button>
        <Button
          variant="contained"
          color="success"
          size="large"
          startIcon={<CheckCircle />}
          onClick={handleAllow}
          sx={{ minWidth: 120 }}
          autoFocus
        >
          Allow
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConnectionPrompt;
