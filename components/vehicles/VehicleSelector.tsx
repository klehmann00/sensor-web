'use client';

import { useState, useRef, useEffect } from 'react';
import { Vehicle } from '@/lib/firebase/vehicleDatabase';

interface VehicleSelectorProps {
  vehicles: Vehicle[];
  selectedVehicleId: string | null;
  onSelect: (vehicleId: string) => void;
  onAddNew: () => void;
}

function getVehicleDisplayName(vehicle: Vehicle): string {
  if (vehicle.nickname) {
    return vehicle.nickname;
  }
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

export default function VehicleSelector({
  vehicles,
  selectedVehicleId,
  onSelect,
  onAddNew
}: VehicleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (vehicleId: string) => {
    onSelect(vehicleId);
    setIsOpen(false);
  };

  const handleAddNew = () => {
    onAddNew();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700 min-w-[160px]"
      >
        <svg
          className="w-4 h-4 text-gray-500 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
          />
        </svg>
        <span className="truncate flex-1 text-left">
          {vehicles.length === 0
            ? 'No vehicles'
            : selectedVehicle
              ? getVehicleDisplayName(selectedVehicle)
              : 'Select vehicle'}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {vehicles.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              No vehicles added yet
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {vehicles.map(vehicle => (
                <button
                  key={vehicle.id}
                  onClick={() => handleSelect(vehicle.id)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 ${
                    vehicle.id === selectedVehicleId ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                >
                  <span className="truncate flex-1">
                    {getVehicleDisplayName(vehicle)}
                  </span>
                  {vehicle.isDefault && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                  {vehicle.id === selectedVehicleId && (
                    <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-gray-200" />

          {/* Add Vehicle option */}
          <button
            onClick={handleAddNew}
            className="w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2 font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Vehicle
          </button>
        </div>
      )}
    </div>
  );
}
