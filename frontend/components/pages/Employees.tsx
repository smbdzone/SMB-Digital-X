'use client'

import React, { useEffect, useState } from 'react'
import { FiPlus, FiEdit, FiTrash2 } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
  registerEmployee, updateEmployee, deleteEmployee, fetchAllEmployees,
  type BankDetails, type User,
} from '@/services/auth.services'
import { useCompanies } from '@/hooks/useCompanies'
import ButtonEmerald from '../ui/ButtonEmerald'
import ModalBox from '../ui/ModalBox'
import Input from '../ui/Input'
import SelectField from '../ui/SelectField'
import { StatusBadge } from '@/components/ui/shared'
import { errorMessage, formatCurrency } from '@/lib/utils'
import { IoIosEyeOff, IoMdEye } from 'react-icons/io'

interface EmployeeForm {
  name: string
  email: string
  password: string
  salaryAmount: string
  salaryCurrency: string
  companyId: string
  position: string
  status: 'active' | 'inactive'
}

const emptyForm: EmployeeForm = {
  name: '', email: '', password: '', salaryAmount: '', salaryCurrency: 'AED',
  companyId: '', position: '', status: 'active',
}

const emptyBank: Required<BankDetails> = { method: '', bankName: '', holderName: '', accountNumber: '', iban: '' }

const Employees = () => {
  const toast = useToast()
  const { token } = useAuth()
  const { companies } = useCompanies()
  const [employees, setEmployees] = useState<User[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState<boolean>(false)

  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [editEmployeeId, setEditEmployeeId] = useState<string>('')
  const [form, setForm] = useState<EmployeeForm>(emptyForm)
  const [bank, setBank] = useState<Required<BankDetails>>(emptyBank)

  useEffect(() => {
    if (token) fetchEmployees()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const fetchEmployees = async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetchAllEmployees(token)
      setEmployees(response.data ?? [])
    } catch (err) {
      const message = errorMessage(err, 'An error occurred while fetching employees')
      setError(message)
      toast.showError(message)
    } finally {
      setLoading(false)
    }
  }

  const companyName = (id?: string) => companies.find(c => c._id === id)?.name

  const handleChangeForm = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const resetForm = () => {
    setForm(emptyForm)
    setBank(emptyBank)
    setEditEmployeeId('')
  }

  const handleOpenModal = (employee?: User) => {
    if (employee) {
      setEditEmployeeId(employee._id)
      setForm({
        name: employee.name,
        email: employee.email,
        password: '',
        salaryAmount: String(employee.salary?.amount ?? ''),
        salaryCurrency: employee.salary?.currency || 'AED',
        companyId: employee.companyId ? String(employee.companyId) : '',
        position: employee.position ?? '',
        status: (employee.status as 'active' | 'inactive') ?? 'active',
      })
      setBank(emptyBank) // bank details are hidden by the API; typing here replaces only the fields you fill in
    } else {
      resetForm()
    }
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    resetForm()
  }

  const handleSubmit = async () => {
    if (!token) return

    if (!form.name.trim() || !form.email.trim()) return toast.showError('Name and email are required')
    if (!editEmployeeId && !form.password.trim()) return toast.showError('A password is required for a new employee')
    if (!editEmployeeId && !form.companyId) return toast.showError('Select the company that pays this employee')
    if (form.salaryAmount !== '' && (!Number.isFinite(Number(form.salaryAmount)) || Number(form.salaryAmount) < 0)) {
      return toast.showError('Enter a valid salary amount')
    }
    if (!/^[A-Za-z]{3}$/.test(form.salaryCurrency.trim())) return toast.showError('Currency must be a 3-letter code, for example AED')

    // only send bank fields that were filled in
    const filledBank = Object.fromEntries(Object.entries(bank).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()])) as BankDetails

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      position: form.position.trim(),
      salaryCurrency: form.salaryCurrency.trim().toUpperCase(),
      ...(form.salaryAmount !== '' ? { salaryAmount: Number(form.salaryAmount) } : {}),
      ...(form.companyId ? { companyId: form.companyId } : {}),
      ...(form.password.trim() ? { password: form.password } : {}),
      ...(Object.keys(filledBank).length ? { bankDetails: filledBank } : {}),
    }

    setLoading(true)
    try {
      if (editEmployeeId) {
        await updateEmployee(token, editEmployeeId, { ...payload, status: form.status })
        toast.showSuccess('Employee updated successfully')
      } else {
        await registerEmployee(token, { ...payload, password: form.password })
        toast.showSuccess('New employee registered')
      }
      handleCloseModal()
      fetchEmployees()
    } catch (err) {
      toast.showError(errorMessage(err, 'Operation failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!token || !confirm('Are you sure you want to delete this employee?')) return
    setLoading(true)
    try {
      await deleteEmployee(id, token)
      toast.showSuccess('Employee deleted successfully')
      fetchEmployees()
    } catch (err) {
      toast.showError(errorMessage(err, 'Failed to delete'))
    } finally {
      setLoading(false)
    }
  }

  const th = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'
  const missingCompany = employees.filter(e => e.role !== 'admin' && !e.companyId).length

  return (
    <>
      <div className='py-4 lg:py-6 flex items-center justify-between'>
        <h4 className='text-md sm:text-xl font-bold font-heading'>Employees Management</h4>
        <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={() => handleOpenModal()} />
      </div>

      {missingCompany > 0 && (
        <div className='mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800'>
          {missingCompany} employee{missingCompany === 1 ? ' has' : 's have'} no company. They are skipped when salaries are generated and cannot submit expenses until you assign one (use the edit button).
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto bg-white shadow rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Email</th>
              <th className={th}>Position</th>
              <th className={th}>Company</th>
              <th className={th}>Salary</th>
              <th className={th}>Status</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && !employees.length ? (
              <tr><td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-500">Loading...</td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="px-6 py-4 text-center text-sm text-red-500">{error}</td></tr>
            ) : employees.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-500">No employees found</td></tr>
            ) : (
              employees.map(emp => (
                <tr key={emp._id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{emp.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{emp.email}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{emp.position}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {companyName(emp.companyId) ? (
                      <span className="text-gray-700">{companyName(emp.companyId)}</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">{emp.companyId ? 'Inactive company' : 'No company'}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {emp.salary?.amount !== undefined ? formatCurrency(emp.salary.amount, emp.salary.currency) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge status={emp.status ?? 'active'} variant="employee" />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleOpenModal(emp)} className="text-blue-600 hover:text-blue-900 transition" title="Edit"><FiEdit className="size-4" /></button>
                      <button onClick={() => handleDelete(emp._id)} className="text-red-600 hover:text-red-900 transition" title="Delete"><FiTrash2 className="size-4" /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      <ModalBox open={modalOpen} onClose={handleCloseModal} size='2xl' title={editEmployeeId ? 'Edit Employee' : 'Add Employee'}>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <Input label='Name' name='name' required placeholder='Employee complete name' value={form.name} handleChange={handleChangeForm} />
          <Input autoComplete='off' label='Email' name='email' required type='email' placeholder='Employee email' value={form.email} handleChange={handleChangeForm} />
          <div className='relative'>
            <Input autoComplete='off' label='Password' name='password' required={!editEmployeeId} value={form.password} handleChange={handleChangeForm} placeholder={editEmployeeId ? 'Leave blank to keep current' : 'Enter Password for Employee'} type={showPassword ? 'text' : 'password'} />
            <div onClick={() => setShowPassword(!showPassword)} className='absolute top-10 right-2'>
              {showPassword ? <IoIosEyeOff size={22} /> : <IoMdEye size={22} />}

            </div>
          </div>
          <Input label='Position & Role' name='position' value={form.position} handleChange={handleChangeForm} placeholder='Position of Employee' />
          <SelectField
            label='Company'
            name='companyId'
            required={!editEmployeeId}
            value={form.companyId}
            onChange={handleChangeForm}
            options={companies.map(c => ({ value: c._id, label: c.name }))}
            placeholder='Select company'
            helperText='The company that pays this salary. Its logo and sender are used on the slip.'
          />
          <div className='grid grid-cols-[1fr_96px] gap-3'>
            <Input label='Salary amount' name='salaryAmount' type='number' min={0} value={form.salaryAmount} handleChange={handleChangeForm} placeholder='Monthly salary' />
            <Input label='Currency' name='salaryCurrency' maxLength={3} value={form.salaryCurrency} handleChange={e => setForm(p => ({ ...p, salaryCurrency: e.target.value.toUpperCase() }))} />
          </div>
          {editEmployeeId && (
            <SelectField
              label='Status'
              name='status'
              value={form.status}
              onChange={handleChangeForm}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
            />
          )}
        </div>

        <div className='mt-6 border-t border-charcoal/5 pt-5'>
          <h5 className='text-sm font-semibold text-charcoal'>Bank details</h5>
          <p className='mt-0.5 text-xs text-charcoal/50'>
            {editEmployeeId ? 'Saved details are hidden for security. Fill in only the fields you want to change.' : 'Optional. Shown on the salary slip.'}
          </p>
          <div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <Input label='Payment method' value={bank.method} handleChange={e => setBank(b => ({ ...b, method: e.target.value }))} placeholder='Bank transfer' />
            <Input label='Bank name' value={bank.bankName} handleChange={e => setBank(b => ({ ...b, bankName: e.target.value }))} />
            <Input label='Account holder' value={bank.holderName} handleChange={e => setBank(b => ({ ...b, holderName: e.target.value }))} />
            <Input label='Account number' value={bank.accountNumber} handleChange={e => setBank(b => ({ ...b, accountNumber: e.target.value }))} />
            <Input label='IBAN' value={bank.iban} handleChange={e => setBank(b => ({ ...b, iban: e.target.value }))} containerClassName='sm:col-span-2' />
          </div>
        </div>

        <div className='mt-6 flex items-end justify-end'>
          <ButtonEmerald onClick={handleSubmit} loading={loading}>{editEmployeeId ? 'Update Employee' : 'Add Employee'}</ButtonEmerald>
        </div>
      </ModalBox>
    </>
  )
}

export default Employees
