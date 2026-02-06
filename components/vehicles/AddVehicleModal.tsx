'use client';

import { useState, useEffect } from 'react';
import { Vehicle } from '@/lib/firebase/vehicleDatabase';
import { getAllMakes, getModelsForMakeYear } from '@/lib/api/vehicleApi';

interface AddVehicleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (vehicle: { year: number; make: string; model: string; nickname?: string }) => void;
  editVehicle?: Vehicle;
}

interface Make {
  MakeId: number;
  MakeName: string;
}

interface Model {
  Model_Name: string;
}

export default function AddVehicleModal({ isOpen, onClose, onSave, editVehicle }: AddVehicleModalProps) {
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState<number>(currentYear);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [nickname, setNickname] = useState('');
  const [errors, setErrors] = useState<{ year?: string; make?: string; model?: string }>({});

  const [makes, setMakes] = useState<Make[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingMakes, setLoadingMakes] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [makeSearch, setMakeSearch] = useState('');
  const [showMakeDropdown, setShowMakeDropdown] = useState(false);

  // Load makes when modal opens
  useEffect(() => {
    if (isOpen && makes.length === 0) {
      setLoadingMakes(true);
      getAllMakes()
        .then(setMakes)
        .catch(console.error)
        .finally(() => setLoadingMakes(false));
    }
  }, [isOpen, makes.length]);

  // Load models when year and make are selected
  useEffect(() => {
    if (year && make) {
      setLoadingModels(true);
      setModel('');
      getModelsForMakeYear(make, year)
        .then(setModels)
        .catch(console.error)
        .finally(() => setLoadingModels(false));
    } else {
      setModels([]);
    }
  }, [year, make]);

  // Reset form when modal opens or editVehicle changes
  useEffect(() => {
    if (isOpen) {
      if (editVehicle) {
        setYear(editVehicle.year);
        setMake(editVehicle.make);
        setMakeSearch(editVehicle.make);
        setModel(editVehicle.model);
        setNickname(editVehicle.nickname || '');
      } else {
        setYear(currentYear);
        setMake('');
        setMakeSearch('');
        setModel('');
        setNickname('');
      }
      setErrors({});
    }
  }, [isOpen, editVehicle, currentYear]);

  const validate = (): boolean => {
    const newErrors: { year?: string; make?: string; model?: string } = {};

    if (!year || year < 1900 || year > currentYear + 1) {
      newErrors.year = `Year must be between 1900 and ${currentYear + 1}`;
    }
    if (!make.trim()) {
      newErrors.make = 'Make is required';
    }
    if (!model.trim()) {
      newErrors.model = 'Model is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    onSave({
      year,
      make: make.trim(),
      model: model.trim(),
      nickname: nickname.trim() || undefined
    });
  };

  const handleSelectMake = (makeName: string) => {
    setMake(makeName);
    setMakeSearch(makeName);
    setShowMakeDropdown(false);
    setModel('');
  };

  const filteredMakes = makes.filter(m =>
    m.MakeName.toLowerCase().includes(makeSearch.toLowerCase())
  );

  const yearOptions = Array.from({ length: currentYear - 1980 + 2 }, (_, i) => currentYear + 1 - i);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold mb-4">
          {editVehicle ? 'Edit Vehicle' : 'Add Vehicle'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Year Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Year <span className="text-red-500">*</span>
            </label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.year ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {errors.year && <p className="text-red-500 text-sm mt-1">{errors.year}</p>}
          </div>

          {/* Make Searchable Dropdown */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Make <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={makeSearch}
              onChange={(e) => {
                setMakeSearch(e.target.value);
                setShowMakeDropdown(true);
                if (e.target.value !== make) setMake('');
              }}
              onFocus={() => setShowMakeDropdown(true)}
              placeholder={loadingMakes ? "Loading makes..." : "Search make..."}
              disabled={loadingMakes}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.make ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {showMakeDropdown && filteredMakes.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {filteredMakes.map(m => (
                  <div
                    key={m.MakeId}
                    onClick={() => handleSelectMake(m.MakeName)}
                    className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                  >
                    {m.MakeName}
                  </div>
                ))}
              </div>
            )}
            {errors.make && <p className="text-red-500 text-sm mt-1">{errors.make}</p>}
          </div>

          {/* Model Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model <span className="text-red-500">*</span>
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!make || loadingModels}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.model ? 'border-red-500' : 'border-gray-300'
              } ${(!make || loadingModels) ? 'bg-gray-100' : ''}`}
            >
              <option value="">
                {loadingModels ? 'Loading models...' : !make ? 'Select make first' : 'Select model'}
              </option>
              {models.map((m, index) => (
                <option key={`${m.Model_Name}-${index}`} value={m.Model_Name}>{m.Model_Name}</option>
              ))}
            </select>
            {errors.model && <p className="text-red-500 text-sm mt-1">{errors.model}</p>}
          </div>

          {/* Nickname */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nickname <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Daily Driver"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
