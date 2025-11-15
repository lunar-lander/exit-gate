import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  CheckCircle,
  Block,
  Visibility,
} from '@mui/icons-material';
import { Rule, RuleCriteria } from '../types';

interface RulesManagerProps {
  rules: Rule[];
  onAddRule: (rule: Rule) => void;
  onUpdateRule: (rule: Rule) => void;
  onDeleteRule: (ruleId: number) => void;
}

const RulesManager: React.FC<RulesManagerProps> = ({
  rules,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState<Partial<Rule>>({
    name: '',
    enabled: true,
    action: 'deny',
    duration: 'forever',
    priority: 0,
    criteria: {},
  });

  const handleOpenDialog = (rule?: Rule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData(rule);
    } else {
      setEditingRule(null);
      setFormData({
        name: '',
        enabled: true,
        action: 'deny',
        duration: 'forever',
        priority: 0,
        criteria: {},
      });
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingRule(null);
  };

  const handleSaveRule = () => {
    const rule: Rule = {
      ...formData,
      name: formData.name || 'Unnamed Rule',
      enabled: formData.enabled ?? true,
      action: formData.action || 'deny',
      duration: formData.duration || 'forever',
      priority: formData.priority || 0,
      criteria: formData.criteria || {},
      created_at: editingRule?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      hit_count: editingRule?.hit_count || 0,
    } as Rule;

    if (editingRule) {
      rule.id = editingRule.id;
      onUpdateRule(rule);
    } else {
      onAddRule(rule);
    }

    handleCloseDialog();
  };

  const handleToggleEnabled = (rule: Rule) => {
    onUpdateRule({ ...rule, enabled: !rule.enabled });
  };

  const updateCriteria = (field: keyof RuleCriteria, value: any) => {
    setFormData({
      ...formData,
      criteria: {
        ...formData.criteria,
        [field]: value || undefined,
      },
    });
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">Firewall Rules</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<Add />}
          onClick={() => handleOpenDialog()}
        >
          Add Rule
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Enabled</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Criteria</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Hits</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>
                  <Switch
                    checked={rule.enabled}
                    onChange={() => handleToggleEnabled(rule)}
                    color="primary"
                  />
                </TableCell>
                <TableCell>{rule.name}</TableCell>
                <TableCell>
                  <Chip
                    icon={rule.action === 'allow' ? <CheckCircle /> : <Block />}
                    label={rule.action.toUpperCase()}
                    color={rule.action === 'allow' ? 'success' : 'error'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {rule.criteria.executable && (
                      <Chip label={`exe: ${rule.criteria.executable.split('/').pop()}`} size="small" />
                    )}
                    {rule.criteria.dest_host && (
                      <Chip label={`host: ${rule.criteria.dest_host}`} size="small" />
                    )}
                    {rule.criteria.dest_ip && (
                      <Chip label={`ip: ${rule.criteria.dest_ip}`} size="small" />
                    )}
                    {rule.criteria.dest_port && (
                      <Chip label={`port: ${rule.criteria.dest_port}`} size="small" />
                    )}
                    {rule.criteria.protocol && (
                      <Chip label={rule.criteria.protocol} size="small" />
                    )}
                  </Box>
                </TableCell>
                <TableCell>{rule.duration}</TableCell>
                <TableCell>{rule.priority}</TableCell>
                <TableCell>{rule.hit_count}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleOpenDialog(rule)}>
                    <Edit />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => rule.id && onDeleteRule(rule.id)}
                  >
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="textSecondary">
                    No rules defined. Create your first rule to start filtering connections.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Rule Editor Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>{editingRule ? 'Edit Rule' : 'Add New Rule'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Rule Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </Grid>

            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Action</InputLabel>
                <Select
                  value={formData.action}
                  label="Action"
                  onChange={(e) => setFormData({ ...formData, action: e.target.value as any })}
                >
                  <MenuItem value="allow">Allow</MenuItem>
                  <MenuItem value="deny">Deny</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Duration</InputLabel>
                <Select
                  value={formData.duration}
                  label="Duration"
                  onChange={(e) => setFormData({ ...formData, duration: e.target.value as any })}
                >
                  <MenuItem value="once">Once</MenuItem>
                  <MenuItem value="process">Process Lifetime</MenuItem>
                  <MenuItem value="untilrestart">Until Restart</MenuItem>
                  <MenuItem value="forever">Forever</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                type="number"
                label="Priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                helperText="Higher priority rules are evaluated first"
              />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                Criteria
              </Typography>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Executable Path"
                value={formData.criteria?.executable || ''}
                onChange={(e) => updateCriteria('executable', e.target.value)}
                placeholder="/usr/bin/firefox"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Destination Host"
                value={formData.criteria?.dest_host || ''}
                onChange={(e) => updateCriteria('dest_host', e.target.value)}
                placeholder="example.com"
              />
            </Grid>

            <Grid item xs={8}>
              <TextField
                fullWidth
                label="Destination IP/Network"
                value={formData.criteria?.dest_ip || formData.criteria?.dest_network || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.includes('/')) {
                    updateCriteria('dest_network', value);
                    updateCriteria('dest_ip', '');
                  } else {
                    updateCriteria('dest_ip', value);
                    updateCriteria('dest_network', '');
                  }
                }}
                placeholder="192.168.1.1 or 10.0.0.0/8"
              />
            </Grid>

            <Grid item xs={4}>
              <TextField
                fullWidth
                type="number"
                label="Port"
                value={formData.criteria?.dest_port || ''}
                onChange={(e) => updateCriteria('dest_port', e.target.value ? parseInt(e.target.value) : '')}
                placeholder="443"
              />
            </Grid>

            <Grid item xs={6}>
              <FormControl fullWidth>
                <InputLabel>Protocol</InputLabel>
                <Select
                  value={formData.criteria?.protocol || ''}
                  label="Protocol"
                  onChange={(e) => updateCriteria('protocol', e.target.value)}
                >
                  <MenuItem value="">Any</MenuItem>
                  <MenuItem value="TCP">TCP</MenuItem>
                  <MenuItem value="UDP">UDP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSaveRule} variant="contained" color="primary">
            {editingRule ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RulesManager;
