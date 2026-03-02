import pandas as pd
import csv

def extract_areas(df, prefix):
    cols = [col for col in df.columns if col.startswith(prefix)]
    areas = []
    for index, row in df.iterrows():
        hit = []
        for col in cols:
            if row[col] == 'Y':
                hit.append(col.replace(prefix + ' - ', ''))
        areas.append('|'.join(hit))
    return areas

print("Loading CSVs...")
df1 = pd.read_csv('/Users/dreeves/lab/crashla/nhtsa-2025-jun-2026-jan.csv', on_bad_lines='skip', low_memory=False)
df2 = pd.read_csv('/Users/dreeves/temp_nhtsa/archive.csv', on_bad_lines='skip', low_memory=False)

print("Extracting areas df1...")
df1['SV Hit'] = extract_areas(df1, 'SV Contact Area')
df1['CP Hit'] = extract_areas(df1, 'CP Contact Area')

print("Extracting areas df2...")
df2['SV Hit'] = extract_areas(df2, 'SV Contact Area')
df2['CP Hit'] = extract_areas(df2, 'CP Contact Area')

print("Concatenating...")
df = pd.concat([df1, df2])

try:
    gemini = pd.read_csv('/Users/dreeves/lab/crashla/faultfrac-gemini.csv')
except pd.errors.ParserError:
    with open('/Users/dreeves/lab/crashla/faultfrac-gemini.csv', 'r') as f:
        data = [line for line in csv.reader(f)]
    header = data[0]
    gemini = pd.DataFrame(data[1:], columns=header)

print("Merging data...")
out_df = pd.merge(gemini, df[['Report ID', 'SV Precrash Speed (MPH)', 'Crash With', 'SV Hit', 'CP Hit', 'Highest Injury Severity Alleged']], left_on='Report ID', right_on='Report ID', how='left')
out_df = out_df.drop_duplicates(subset=['Report ID'], keep='first')
out_df = out_df.rename(columns={'Report ID': 'reportID', 'SV Precrash Speed (MPH)': 'speed', 'Crash With': 'crashwith', 'Highest Injury Severity Alleged': 'severity', 'SV Hit': 'svhit', 'CP Hit': 'cphit'})

print("Cleaning data...")
out_df['speed'] = out_df['speed'].fillna(0).astype('str').replace('nan', '0').replace('Unknown', '0')
out_df['crashwith'] = out_df['crashwith'].fillna('Unknown')
out_df['severity'] = out_df['severity'].fillna('No Injuries Reported')
out_df['svhit'] = out_df['svhit'].fillna('')
out_df['cphit'] = out_df['cphit'].fillna('')

out_df = out_df[['reportID', 'speed', 'crashwith', 'svhit', 'cphit', 'severity', 'faultfrac', 'reasoning']]
out_df.to_csv('/Users/dreeves/lab/crashla/faultfrac-gemini.csv', index=False, quoting=csv.QUOTE_MINIMAL)

print("Done!")
