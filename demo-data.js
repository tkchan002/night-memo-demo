const today = () => new Date().toISOString().slice(0, 10);

export const DEMO_WARDS = [
  {code:'C10', display_name:'Ward C10', phone:'6397', fax:'3129', empty_bed_gender_mode:'male', manager_section:'Male', display_order:10, capacity:40},
  {code:'E10', display_name:'Ward E10', phone:'9358', fax:'2921', empty_bed_gender_mode:'male', manager_section:'Male', display_order:20, capacity:40},
  {code:'G2',  display_name:'Ward G2',  phone:'8072', fax:'4846', empty_bed_gender_mode:'male', manager_section:'Male', display_order:30, capacity:36},
  {code:'F10', display_name:'Ward F10', phone:'8973', fax:'7432', empty_bed_gender_mode:'male', manager_section:'Male', display_order:40, capacity:40},
  {code:'E6',  display_name:'Ward E6',  phone:'2372', fax:'9476', empty_bed_gender_mode:'male', manager_section:'Male', display_order:50, capacity:36},
  {code:'C6',  display_name:'Ward C6',  phone:'5333', fax:'1137', empty_bed_gender_mode:'male', manager_section:'Male', display_order:60, capacity:40},
  {code:'G10', display_name:'Ward G10', phone:'5834', fax:'1153', empty_bed_gender_mode:'male', manager_section:'Male', display_order:70, capacity:40},
  {code:'G11', display_name:'Ward G11', phone:'6624', fax:'4882', empty_bed_gender_mode:'dynamic', manager_section:'Male', display_order:80, capacity:40},
  {code:'B10', display_name:'Ward B10', phone:'4662', fax:'8510', empty_bed_gender_mode:'male', manager_section:'Male', display_order:90, capacity:40},
  {code:'H6',  display_name:'Ward H6',  phone:'1075', fax:'2810', empty_bed_gender_mode:'dynamic', manager_section:'Male', display_order:100, capacity:36},
];

const range = (n=30) => Array.from({length:n+1}, (_,i)=>String(i));

export const DEMO_REPORT_ITEMS = [
  {key:'admissionEC', section:'admission', label:'Admission E/C', input_type:'dropdown', options:range(30), sort_order:10, builtin:true, config:{storage:'direct'}},
  {key:'admissionCC', section:'admission', label:'Admission C/C', input_type:'dropdown', options:range(30), sort_order:20, builtin:true, config:{storage:'direct'}},
  {key:'discharge', section:'admission', label:'Discharge', input_type:'dropdown', options:range(30), sort_order:30, builtin:true, config:{storage:'direct'}},
  {key:'death', section:'admission', label:'Death', input_type:'dropdown', options:range(20), sort_order:40, builtin:true, config:{storage:'direct'}},
  {key:'transferIn', section:'admission', label:'T/I (Transfer In) Gen', input_type:'dropdown', options:range(20), sort_order:50, builtin:true, config:{storage:'direct'}},
  {key:'transferOut', section:'admission', label:'T/O (Transfer Out) Gen', input_type:'dropdown', options:range(20), sort_order:60, builtin:true, config:{storage:'direct'}},
  {key:'totalPatientM', section:'bedcount', label:'Total Patient', input_type:'number', options:[], sort_order:70, builtin:true, config:{storage:'direct'}},

  {key:'iCRE', section:'infection', label:'CRE', input_type:'bed_chooser', options:[], sort_order:100, builtin:true, config:{storage:'infBeds'}},
  {key:'iVRE', section:'infection', label:'VRE', input_type:'bed_chooser', options:[], sort_order:110, builtin:true, config:{storage:'infBeds'}},
  {key:'iCOV', section:'infection', label:'COVID', input_type:'bed_chooser', options:[], sort_order:120, builtin:true, config:{storage:'infBeds'}},
  {key:'iMDR', section:'infection', label:'MDRA', input_type:'bed_chooser', options:[], sort_order:130, builtin:true, config:{storage:'infBeds'}},
  {key:'iCD', section:'infection', label:'CD+ve', input_type:'bed_chooser', options:[], sort_order:140, builtin:true, config:{storage:'infBeds'}},
  {key:'iInf', section:'infection', label:'Inf +ve', input_type:'bed_chooser', options:[], sort_order:150, builtin:true, config:{storage:'infBeds'}},
  {key:'iCA', section:'infection', label:'Candida Auris Other Contact', input_type:'bed_chooser', options:[], sort_order:160, builtin:true, config:{storage:'infBeds'}},

  {key:'dMV', section:'devices', label:'MV', input_type:'bed_or_count', options:[], sort_order:200, builtin:true, config:{storage:'devBeds'}},
  {key:'dNIV', section:'devices', label:'NIV / BiPAP', input_type:'bed_or_count', options:[], sort_order:210, builtin:true, config:{storage:'devBeds'}},
  {key:'dHF', section:'devices', label:'HFNC', input_type:'bed_or_count', options:[], sort_order:220, builtin:true, config:{storage:'devBeds'}},
  {key:'dHD', section:'devices', label:'HD', input_type:'bed_or_count', options:[], sort_order:230, builtin:true, config:{storage:'devBeds'}},
  {key:'dCA', section:'devices', label:'CAPD', input_type:'bed_or_count', options:[], sort_order:240, builtin:true, config:{storage:'devBeds'}},
];

export const DEMO_STAFF = DEMO_WARDS.flatMap((w, idx) => [
  {ward_code:w.code, role:'APN', name:`${w.code} Demo APN`, appointment_date:'2022-03-01', active:true, display_order:10},
  {ward_code:w.code, role:'RN', name:`${w.code} Demo RN ${idx+1}`, appointment_date:'2024-08-05', active:true, display_order:20},
  {ward_code:w.code, role:'RN', name:`${w.code} Demo RN ${idx+11}`, appointment_date:'2025-07-28', active:true, display_order:30},
]);

function samplePayload(ward, i) {
  const capacity = ward.capacity;
  const total = capacity - (i % 5);
  const dynamicDetails = ward.empty_bed_gender_mode === 'dynamic'
    ? Array.from({length:capacity-total}, (_,j)=>({location:String(capacity-j), gender:j%2===0?'M':'F', remark:j===0 && i%3===0?'HZ':''}))
    : [];
  return {
    admissionEC:String((i*3+2)%11), admissionCC:String(i%3), discharge:String((i*2+3)%10), death:String(i%2),
    transferIn:String(i%4), transferOut:String((i+1)%4), totalPatientM:String(total),
    emptyBeds:{count:capacity-total, details:dynamicDetails},
    earlyBirds:i%3===0?[{bed:String(10+i),dest:'Rehab'}]:[],
    infBeds:{iCRE:i%4===0?[32]:[],iVRE:[],iCOV:[],iMDR:[],iCD:[],iInf:i%5===0?[12]:[],iCA:[]},
    devBeds:{dMV:{mode:'beds',count:0,beds:i%2===0?[11]:[]},dNIV:{mode:'beds',count:0,beds:i%3===0?[21]:[]},dHF:{mode:'beds',count:0,beds:[]},dHD:{mode:'count',count:i%2,beds:[]},dCA:{mode:'beds',count:0,beds:[]}},
    dynamicItems:{}, nilSpecial:true, patients:[], nilConsultation:true, consultations:[], nilIntubation:true, intubations:[],
    nurses:[{role:'RN',name:`${ward.code} Demo RN ${i+1}`,appt:'05/08/2024',runner:i%4===0,source:'ward_staff'}],
    staffAM:String(4+(i%3)*0.5), staffPM:String(4+(i%2)*0.5), sigRank:'RN', sigName:`${ward.code} Demo RN ${i+1}`, sigAppt:'05/08/2024',
    savedAt:new Date().toISOString(),
  };
}

export const DEMO_REPORTS = DEMO_WARDS.map((ward, i) => ({ward_code:ward.code, report_date:today(), payload:samplePayload(ward,i), bed_capacity_snapshot:ward.capacity, form_version:1}));

export const DEMO_ACCOUNTS = [
  ...DEMO_WARDS.map(w => ({login_id:`${w.code.toLowerCase()}@nightmemo.local`, display_name:`Ward ${w.code}`, role:'ward', ward_code:w.code, active:true})),
  {login_id:'patrolnight@nightmemo.local', display_name:'Patrol Night', role:'manager', ward_code:null, active:true},
  {login_id:'nightmaintenance@nightmemo.local', display_name:'Night Memo Maintenance', role:'maintenance', ward_code:null, active:true},
];
