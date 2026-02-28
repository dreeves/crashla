const VMT_CSV_TEXT = /* VMT_CSV_START */
`company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,coverage,incident_coverage,incident_coverage_min,incident_coverage_max,rationale
tesla,2025-06,1806,1806,1806,1806,1.0,1,1,1,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla,2025-07,16715.5,18521.5,12650,20781,1.0,1,1,1,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla,2025-08,68200,86721.5,68200,68200,1.0,1,1,1,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla,2025-09,90202,176923.5,88550,91854,1.0,1,1,1,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla,2025-10,80061,256984.5,67965,92157,1.0,1,1,1,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla,2025-11,103800,360784.5,103800,103800,1.0,1,1,1,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla,2025-12,146870.5,507655,111351,182390,1.0,1,1,1,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla,2026-01,139318.5,646973.5,92690,185947,0.484,1.0,1.0,1.0,Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
waymo,2025-06,7055803,7055803,5997433,8114173,1.0,1,1,1,US est.: scale CA driverless VMT incl deadhead to all US using Waymo RO-mile city shares (through Sep 2025); ±15%.
waymo,2025-07,9643781,16699584,8197214,11090348,1.0,1,1,1,US est.: scale CA driverless VMT incl deadhead to all US using Waymo RO-mile city shares (through Sep 2025); ±15%.
waymo,2025-08,11021172,27720756,9367996,12674348,1.0,1,1,1,US est.: scale CA driverless VMT incl deadhead to all US using Waymo RO-mile city shares (through Sep 2025); ±15%.
waymo,2025-09,12991437,40712193,11042721,14940153,1.0,1,1,1,US est.: scale CA driverless VMT incl deadhead to all US using Waymo RO-mile city shares (through Sep 2025); ±15%.
waymo,2025-10,15812060,56524253,11068442,20555678,1.0,1,1,1,US est.: extrapolate beyond Sep 2025 then scale to all US; -30%/+30%.
waymo,2025-11,19245080,75769333,13471556,25018604,1.0,1,1,1,US est.: extrapolate beyond Sep 2025 then scale to all US; -30%/+30%.
waymo,2025-12,23423456,99192789,16396419,30450493,1.0,1,1,1,US est.: extrapolate beyond Sep 2025 then scale to all US; -30%/+30%.
waymo,2026-01,28509017,127701806,19956312,37061722,0.484,0.5214,0.32,0.625,US est.: extrapolate beyond Sep 2025 then scale to all US; -30%/+30%.
zoox,2025-06,120000,120000,60000,240000,1.0,1,1,1,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
zoox,2025-07,130000,250000,65000,260000,1.0,1,1,1,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
zoox,2025-08,145000,395000,72500,290000,1.0,1,1,1,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
zoox,2025-09,160000,555000,80000,320000,1.0,1,1,1,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
zoox,2025-10,175000,730000,87500,350000,1.0,1,1,1,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
zoox,2025-11,190000,920000,95000,380000,1.0,1,1,1,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
zoox,2025-12,205000,1125000,102500,410000,1.0,1,1,1,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
zoox,2026-01,220000,1345000,110000,440000,0.484,0.6667,0.6667,0.6667,US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
`
/* VMT_CSV_END */;
