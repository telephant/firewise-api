"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeMember = exports.inviteUser = exports.getLedgerMembers = exports.deleteLedger = exports.updateLedger = exports.createLedger = exports.getLedger = exports.getLedgers = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const getLedgers = async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: ledgerUsers, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('ledger_id, role')
            .eq('user_id', userId);
        if (luError) {
            throw new error_1.AppError('Failed to fetch ledgers', 500);
        }
        if (!ledgerUsers || ledgerUsers.length === 0) {
            res.json({ success: true, data: [] });
            return;
        }
        const ledgerIds = ledgerUsers.map((lu) => lu.ledger_id);
        const roleMap = new Map(ledgerUsers.map((lu) => [lu.ledger_id, lu.role]));
        const { data: ledgers, error } = await supabase_1.supabaseAdmin
            .from('ledgers')
            .select('*')
            .in('id', ledgerIds)
            .order('created_at', { ascending: false });
        if (error) {
            throw new error_1.AppError('Failed to fetch ledgers', 500);
        }
        const ledgersWithRole = (ledgers || []).map((ledger) => ({
            ...ledger,
            role: roleMap.get(ledger.id),
        }));
        res.json({ success: true, data: ledgersWithRole });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch ledgers' });
    }
};
exports.getLedgers = getLedgers;
const getLedger = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', id)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        const { data: ledger, error } = await supabase_1.supabaseAdmin
            .from('ledgers')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !ledger) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        res.json({
            success: true,
            data: { ...ledger, role: ledgerUser.role },
        });
    }
    catch {
        res.status(500).json({ success: false, error: 'Failed to fetch ledger' });
    }
};
exports.getLedger = getLedger;
const createLedger = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, description } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'Name is required' });
            return;
        }
        const { data: ledger, error } = await supabase_1.supabaseAdmin
            .from('ledgers')
            .insert({
            name: name.trim(),
            description: description?.trim() || null,
            created_by: userId,
        })
            .select()
            .single();
        if (error || !ledger) {
            throw new error_1.AppError('Failed to create ledger', 500);
        }
        const { error: luError } = await supabase_1.supabaseAdmin.from('ledger_users').insert({
            ledger_id: ledger.id,
            user_id: userId,
            role: 'owner',
            created_by: userId,
        });
        if (luError) {
            await supabase_1.supabaseAdmin.from('ledgers').delete().eq('id', ledger.id);
            throw new error_1.AppError('Failed to create ledger membership', 500);
        }
        res.status(201).json({
            success: true,
            data: { ...ledger, role: 'owner' },
        });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to create ledger' });
    }
};
exports.createLedger = createLedger;
const updateLedger = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { name, description } = req.body;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', id)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        const updates = { updated_at: new Date().toISOString() };
        if (name !== undefined)
            updates.name = name.trim();
        if (description !== undefined)
            updates.description = description?.trim() || null;
        const { data: ledger, error } = await supabase_1.supabaseAdmin
            .from('ledgers')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error || !ledger) {
            throw new error_1.AppError('Failed to update ledger', 500);
        }
        res.json({ success: true, data: ledger });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to update ledger' });
    }
};
exports.updateLedger = updateLedger;
const deleteLedger = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', id)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        if (ledgerUser.role !== 'owner') {
            res.status(403).json({ success: false, error: 'Only owner can delete ledger' });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin.from('ledgers').delete().eq('id', id);
        if (error) {
            throw new error_1.AppError('Failed to delete ledger', 500);
        }
        res.json({ success: true, message: 'Ledger deleted successfully' });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to delete ledger' });
    }
};
exports.deleteLedger = deleteLedger;
const getLedgerMembers = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { data: userMembership, error: checkError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', id)
            .eq('user_id', userId)
            .single();
        if (checkError || !userMembership) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        const { data: members, error } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('user_id, role, created_at')
            .eq('ledger_id', id);
        if (error) {
            throw new error_1.AppError('Failed to fetch members', 500);
        }
        const userIds = members?.map((m) => m.user_id) || [];
        const { data: profiles, error: profilesError } = await supabase_1.supabaseAdmin
            .from('profiles')
            .select('*')
            .in('id', userIds);
        if (profilesError) {
            throw new error_1.AppError('Failed to fetch member profiles', 500);
        }
        const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
        const membersWithProfiles = (members || []).map((m) => ({
            ...m,
            profile: profileMap.get(m.user_id),
        }));
        res.json({ success: true, data: membersWithProfiles });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch members' });
    }
};
exports.getLedgerMembers = getLedgerMembers;
const inviteUser = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { email } = req.body;
        if (!email || typeof email !== 'string') {
            res.status(400).json({ success: false, error: 'Email is required' });
            return;
        }
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', id)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        if (ledgerUser.role !== 'owner') {
            res.status(403).json({ success: false, error: 'Only owner can invite users' });
            return;
        }
        const { data: invitedUser, error: userError } = await supabase_1.supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', email.toLowerCase())
            .single();
        if (userError || !invitedUser) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        const { data: existingMember } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('id')
            .eq('ledger_id', id)
            .eq('user_id', invitedUser.id)
            .single();
        if (existingMember) {
            res.status(400).json({ success: false, error: 'User is already a member' });
            return;
        }
        const { data: membership, error } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .insert({
            ledger_id: id,
            user_id: invitedUser.id,
            role: 'member',
            created_by: userId,
        })
            .select()
            .single();
        if (error || !membership) {
            throw new error_1.AppError('Failed to invite user', 500);
        }
        res.status(201).json({ success: true, data: membership });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to invite user' });
    }
};
exports.inviteUser = inviteUser;
const removeMember = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, memberId } = req.params;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', id)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        if (ledgerUser.role !== 'owner') {
            res.status(403).json({ success: false, error: 'Only owner can remove members' });
            return;
        }
        if (memberId === userId) {
            res.status(400).json({ success: false, error: 'Cannot remove yourself' });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .delete()
            .eq('ledger_id', id)
            .eq('user_id', memberId);
        if (error) {
            throw new error_1.AppError('Failed to remove member', 500);
        }
        res.json({ success: true, message: 'Member removed successfully' });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to remove member' });
    }
};
exports.removeMember = removeMember;
//# sourceMappingURL=ledger.controller.js.map